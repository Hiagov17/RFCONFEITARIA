# 🍰 Loja de doces — loja online temporária

Link único para WhatsApp, estoque em tempo real (protegido contra compras simultâneas), pedidos e painel admin.
Stack: Node.js + Express + SQLite (better-sqlite3). Sem build de frontend.

- Loja pública: `/`   ·   Painel: `/admin`

## 1. Subir para o GitHub
```bash
cd loja-doces
git init && git add . && git commit -m "Loja de doces"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/loja-doces.git
git push -u origin main
```
(Crie antes um repositório vazio em github.com/new. Deixe **privado**.)

## 2. Deploy no Render (mais simples)
1. render.com → **New → Blueprint** → conecte o repositório. O `render.yaml` configura tudo.
2. Preencha `ADMIN_USER` e `ADMIN_PASSWORD` quando pedir.
3. Aguarde o build. Seu link será `https://loja-doces.onrender.com` — é o que você manda no WhatsApp.

> O banco fica em disco persistente (`/data`), que exige plano pago. No plano gratuito o banco
> **apaga a cada deploy/reinício** — não use para vendas reais.

## Alternativa: Railway ou Fly.io (usam o Dockerfile)
- **Railway:** New Project → Deploy from GitHub. Em *Variables* defina `ADMIN_USER`, `ADMIN_PASSWORD`, `SECRET`.
  Adicione um **Volume** montado em `/data`.
- **Fly.io:** `fly launch`, `fly volumes create dados --size 1`, monte em `/data`, `fly secrets set ADMIN_PASSWORD=... SECRET=...`.

## Rodar local
```bash
npm install
ADMIN_USER=admin ADMIN_PASSWORD=senha npm start
```

## Variáveis
| Nome | Função |
|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | Login do painel (padrão `admin`/`admin123` — **troque**) |
| `SECRET` | Assina a sessão do admin |
| `DB_PATH` | Caminho do arquivo SQLite (use um disco persistente) |
| `PORT` | Porta (a hospedagem define sozinha) |

## Uso diário
1. `/admin` → **Nova venda** (pode copiar os produtos da venda anterior).
2. Ajuste quantidades → **Compartilhar no WhatsApp**.
3. Acompanhe estoque e pedidos; mude o status de cada pedido.

## Backup
Baixe periodicamente o arquivo do banco (`/data/loja.db`) pelo painel da hospedagem.
