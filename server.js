'use strict';
const http = require('http'), fs = require('fs'), crypto = require('crypto'), path = require('path');

const CFG = {
  port: +process.env.PORT || 3000,
  origin: '*',
  dir: path.join(__dirname, 'data')
};

const SPIN_TICKETS = 5, SIGNUP_TICKETS = 20;
const VALUE = { m25: 25, m50: 50, m75: 75, m125: 125, m250: 250, jack10: 5000, jack14: 4000, jack18: 3000 };
const PACKS = { 30: 150, 130: 600, 270: 1200 };

fs.mkdirSync(CFG.dir, { recursive: true });
const USERS_F = path.join(CFG.dir, 'users.json');
let users = fs.existsSync(USERS_F) ? JSON.parse(fs.readFileSync(USERS_F, 'utf8')) : {};
const saveUsers = () => { const t = USERS_F + '.tmp'; fs.writeFileSync(t, JSON.stringify(users)); fs.renameSync(t, USERS_F); };

const userToken = id => crypto.createHmac('sha256', 'secret123').update(id).digest('hex');
const safeEq = (a, b) => crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b)));

const json = (res, code, obj) => { 
    res.writeHead(code, { 
        'content-type': 'application/json; charset=utf-8', 
        'access-control-allow-origin': CFG.origin, 
        'access-control-allow-headers': 'authorization,content-type,x-user' 
    }); 
    res.end(JSON.stringify(obj)); 
};

const readBody = req => new Promise((ok, no) => { 
    let b = ''; 
    req.on('data', d => { b += d; }); 
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); 
});

function userAuth(req) {
  const id = req.headers['x-user'] || '', tok = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!id || !users[id] || !safeEq(tok, userToken(id))) return null;
  return users[id];
}

// ==== THE DARK PSYCHOLOGY LOGIC ====
function getPrizeForUser(u) {
    if (u.totalSpins === 0) return { key: 'm50', value: 50, nearMiss: false };
    if (u.totalSpins === 1) return { key: 'm25', value: 25, nearMiss: false };
    if (u.totalSpins === 2) return { key: 'm75', value: 75, nearMiss: false };
    
    if (u.totalSpins === 3) {
        return { key: 'none', value: 0, nearMiss: true, target: 'm125' }; 
    }

    let winChance = 0.45; 
    if (u.lossStreak >= 3) winChance = 0.65;
    if (u.lossStreak >= 5) winChance = 0.85;
    if (u.lossStreak >= 8) winChance = 0.98;

    if (Math.random() < winChance) {
        const pKeys = ['m25', 'm50', 'm75', 'm125'];
        const pWeights = [50, 30, 15, 5];
        const r = Math.random() * 100;
        let sum = 0;
        for (let i = 0; i < pKeys.length; i++) {
            sum += pWeights[i];
            if (r < sum) return { key: pKeys[i], value: VALUE[pKeys[i]], nearMiss: false };
        }
        return { key: 'm25', value: 25, nearMiss: false };
    } else {
        return { key: 'none', value: 0, nearMiss: false };
    }
}

const routes = {
  async 'POST /api/register'(req, res) {
    const b = await readBody(req), id = crypto.randomBytes(6).toString('hex');
    users[id] = { 
        id, name: String(b.name || 'שחקן').slice(0, 30), 
        tickets: SIGNUP_TICKETS, free: 0, cash: 0, 
        totalSpins: 0, lossStreak: 0 
    };
    saveUsers(); 
    json(res, 200, { id, token: userToken(id), tickets: SIGNUP_TICKETS });
  },

  async 'GET /api/user'(req, res) {
    const u = userAuth(req); if (!u) return json(res, 401, { error: 'auth' });
    json(res, 200, { tickets: u.tickets, free: u.free, cash: u.cash, totalSpins: u.totalSpins });
  },

  async 'POST /api/spin'(req, res) {
    const u = userAuth(req); if (!u) return json(res, 401, { error: 'auth' });
    
    const paid = u.free < 1; 
    if (paid && u.tickets < SPIN_TICKETS) return json(res, 402, { error: 'אין מספיכ כרטיסים' });
    
    paid ? u.tickets -= SPIN_TICKETS : u.free--;
    
    const result = getPrizeForUser(u);
    
    u.totalSpins++;
    if (result.value > 0) {
        u.cash += result.value;
        u.lossStreak = 0;
    } else {
        u.lossStreak++;
    }
    saveUsers();
    
    json(res, 200, { 
        prize: result.key, 
        value: result.value, 
        nearMiss: result.nearMiss || false,
        target: result.target || null,
        tickets: u.tickets, 
        freeSpins: u.free, 
        cash: u.cash
    });
  }
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') json(res, 204, {});
  const h = routes[req.method + ' ' + u.pathname];
  if (!h) return json(res, 404, { error: 'not_found' });
  try { await h(req, res, u); } catch (e) { console.error(e); json(res, 500, { error: 'server' }); }
});

server.listen(CFG.port, () => console.log('Server running on port ' + CFG.port));
