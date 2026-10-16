const express = require('express'), Database = require('better-sqlite3'), crypto = require('crypto');
const fs = require('fs'), path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'loja.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
create table if not exists settings(id integer primary key, shop_name text, owner text, intro text, logo text, whatsapp text);
create table if not exists sales(id integer primary key autoincrement, title text, date text, location text, hours text, active integer default 0, created text default current_timestamp);
create table if not exists products(id integer primary key autoincrement, sale_id integer, name text, description text, price_cents integer, initial integer, stock integer, photo text, active integer default 1);
create table if not exists customers(phone text primary key, name text, created text default current_timestamp);
create table if not exists orders(id integer primary key autoincrement, sale_id integer, number integer, customer_name text, phone text, note text, total_cents integer, status text default 'novo', created text default current_timestamp);
create table if not exists order_items(id integer primary key autoincrement, order_id integer, product_id integer, name text, price_cents integer, qty integer);
`);
db.prepare(`insert or ignore into settings values(1,'RF Confeitaria e Doces','','Doces feitos com carinho ❤️','','')`).run();

const USER = process.env.ADMIN_USER || 'admin', PASS = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SECRET || 'troque-este-segredo-' + PASS;
const sign = e => crypto.createHmac('sha256', SECRET).update(String(e)).digest('hex');
const auth = (req, res, next) => {
  const [exp, sig] = (req.headers.authorization || '').slice(7).split('.');
  if (exp && Number(exp) > Date.now() && sig === sign(exp)) return next();
  res.status(401).json({ error: 'Faça login novamente.' });
};
const fail = (msg, code = 409) => Object.assign(new Error(msg), { code });
const cents = v => Math.round(Number(String(v).replace(',', '.')) * 100) || 0;

const app = express();
app.use(express.json({ limit: '3mb' }));
app.use(express.static(__dirname + '/public'));
app.get('/healthz', (_, res) => res.send('ok'));
app.get('/admin', (_, res) => res.sendFile(__dirname + '/public/admin.html'));

// ---------- público ----------
app.get('/api/store', (req, res) => {
  const settings = db.prepare('select shop_name,owner,intro,logo,whatsapp from settings').get();
  const sale = req.query.sale
    ? db.prepare('select * from sales where id=?').get(req.query.sale)
    : db.prepare('select * from sales where active=1 order by id desc limit 1').get();
  const products = sale ? db.prepare('select id,name,description,price_cents,stock,photo from products where sale_id=? and active=1 order by id').all(sale.id) : [];
  res.json({ settings, sale: sale && sale.active ? sale : null, products });
});

const createOrder = db.transaction(b => {
  const sale = db.prepare('select * from sales where id=? and active=1').get(b.sale_id);
  if (!sale) throw fail('Esta venda foi encerrada.');
  const name = String(b.name || '').trim().slice(0, 80), phone = String(b.phone || '').replace(/\D/g, '');
  if (!name || phone.length < 10) throw fail('Informe seu nome e um WhatsApp válido.', 400);
  const want = new Map();
  for (const it of b.items || []) want.set(+it.product_id, (want.get(+it.product_id) || 0) + (parseInt(it.qty) || 0));
  if (!want.size) throw fail('Seu pedido está vazio.', 400);
  let total = 0; const lines = [];
  for (const [pid, qty] of want) {
    const p = db.prepare('select * from products where id=? and sale_id=? and active=1').get(pid, sale.id);
    if (!p || qty < 1) throw fail('Um dos produtos não está mais disponível.');
    // decremento condicional: só passa se ainda houver estoque (atômico)
    const r = db.prepare('update products set stock=stock-? where id=? and stock>=?').run(qty, pid, qty);
    if (!r.changes) throw fail(p.stock <= 0 ? `${p.name} acabou! 😢` : `Restam só ${p.stock} de ${p.name}.`);
    total += qty * p.price_cents; lines.push({ p, qty });
  }
  const number = db.prepare('select coalesce(max(number),0)+1 n from orders where sale_id=?').get(sale.id).n;
  const oid = db.prepare('insert into orders(sale_id,number,customer_name,phone,note,total_cents) values(?,?,?,?,?,?)')
    .run(sale.id, number, name, phone, String(b.note || '').slice(0, 300), total).lastInsertRowid;
  for (const { p, qty } of lines) db.prepare('insert into order_items(order_id,product_id,name,price_cents,qty) values(?,?,?,?,?)').run(oid, p.id, p.name, p.price_cents, qty);
  db.prepare('insert into customers(phone,name) values(?,?) on conflict(phone) do update set name=excluded.name').run(phone, name);
  return { number, total_cents: total };
});
app.post('/api/orders', (req, res) => {
  try { res.json(createOrder(req.body)); }
  catch (e) { res.status(e.code || 500).json({ error: e.code ? e.message : 'Erro inesperado. Tente de novo.' }); }
});

// ---------- admin ----------
app.post('/api/login', (req, res) => {
  const ok = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (!ok(String(req.body.user || ''), USER) || !ok(String(req.body.password || ''), PASS)) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  const exp = Date.now() + 7 * 864e5; res.json({ token: exp + '.' + sign(exp) });
});
const admin = express.Router(); admin.use(auth); app.use('/api/admin', admin);

admin.get('/settings', (_, res) => res.json(db.prepare('select * from settings').get()));
admin.put('/settings', (req, res) => {
  const b = req.body;
  db.prepare('update settings set shop_name=?,owner=?,intro=?,logo=?,whatsapp=? where id=1').run(b.shop_name, b.owner, b.intro, b.logo || '', String(b.whatsapp || '').replace(/\D/g, ''));
  res.json({ ok: true });
});
admin.get('/sales', (_, res) => res.json(db.prepare('select * from sales order by id desc').all()));
admin.post('/sales', db.transaction((req, res) => {
  const b = req.body;
  db.prepare('update sales set active=0').run();
  const id = db.prepare('insert into sales(title,date,location,hours,active) values(?,?,?,?,1)').run(b.title, b.date, b.location, b.hours).lastInsertRowid;
  if (b.copy_from) for (const p of db.prepare('select * from products where sale_id=?').all(b.copy_from))
    db.prepare('insert into products(sale_id,name,description,price_cents,initial,stock,photo,active) values(?,?,?,?,?,?,?,1)').run(id, p.name, p.description, p.price_cents, p.initial, p.initial, p.photo);
  res.json({ id });
}));
admin.put('/sales/:id', (req, res) => {
  const b = req.body, id = req.params.id;
  if (b.active) db.prepare('update sales set active=0').run();
  db.prepare('update sales set title=?,date=?,location=?,hours=?,active=? where id=?').run(b.title, b.date, b.location, b.hours, b.active ? 1 : 0, id);
  res.json({ ok: true });
});
admin.get('/sales/:id', (req, res) => {
  const sale = db.prepare('select * from sales where id=?').get(req.params.id);
  const products = db.prepare('select * from products where sale_id=? order by id').all(req.params.id);
  const orders = db.prepare('select * from orders where sale_id=? order by id desc').all(req.params.id)
    .map(o => ({ ...o, items: db.prepare('select name,qty,price_cents from order_items where order_id=?').all(o.id) }));
  res.json({ sale, products, orders });
});
const prodVals = b => [b.name, b.description || '', cents(b.price), Math.max(0, parseInt(b.initial) || 0), b.photo || '', b.active ? 1 : 0];
admin.post('/products', (req, res) => {
  const v = prodVals(req.body);
  db.prepare('insert into products(sale_id,name,description,price_cents,initial,stock,photo,active) values(?,?,?,?,?,?,?,?)').run(req.body.sale_id, v[0], v[1], v[2], v[3], v[3], v[4], v[5]);
  res.json({ ok: true });
});
admin.put('/products/:id', db.transaction((req, res) => {
  const old = db.prepare('select * from products where id=?').get(req.params.id), v = prodVals(req.body);
  const stock = Math.max(0, old.stock + v[3] - old.initial); // ajusta o disponível conforme o novo inicial
  db.prepare('update products set name=?,description=?,price_cents=?,initial=?,photo=?,active=?,stock=? where id=?').run(...v, stock, req.params.id);
  res.json({ ok: true });
}));
admin.delete('/products/:id', (req, res) => { db.prepare('delete from products where id=?').run(req.params.id); res.json({ ok: true }); });
const setStatus = db.transaction((id, st) => {
  const o = db.prepare('select * from orders where id=?').get(id);
  const items = db.prepare('select * from order_items where order_id=?').all(o.id);
  if (st === 'cancelado' && o.status !== 'cancelado') for (const i of items) db.prepare('update products set stock=stock+? where id=?').run(i.qty, i.product_id);
  if (o.status === 'cancelado' && st !== 'cancelado') for (const i of items)
    if (!db.prepare('update products set stock=stock-? where id=? and stock>=?').run(i.qty, i.product_id, i.qty).changes) throw fail(`Sem estoque de ${i.name} para reativar o pedido.`);
  db.prepare('update orders set status=? where id=?').run(st, o.id);
});
admin.put('/orders/:id', (req, res) => {
  const st = req.body.status;
  if (!['novo', 'confirmado', 'pago', 'entregue', 'cancelado'].includes(st)) return res.status(400).json({ error: 'Status inválido' });
  try { setStatus(req.params.id, st); res.json({ ok: true }); } catch (e) { res.status(409).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Loja no ar na porta ' + (process.env.PORT || 3000)));
