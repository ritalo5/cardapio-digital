# Cardápio Digital

Cardápio online para confeitaria, com **painel de edição próprio** — a confeiteira
troca fotos, textos, preços, produtos e as cores da marca sem mexer em código e sem
depender de quem programou.

Site público e painel rodam no **mesmo serviço** (um processo Node, uma porta), o que
elimina problema de CORS e de conteúdo misto.

## O que o painel permite editar

- **Produtos** — nome, descrição, preço, categoria, selo, foto, disponível, ordem
- **Categorias** — criar, renomear, reordenar e apagar
- **Monte seu Bolo** — construtor de bolo com etapas, opções e preços configuráveis
  (tamanho, massa, recheios com limite, cobertura, cor, data de entrega)
- **Dados da loja** — nome, subtítulo, frase de destaque, foto ou logo do topo,
  aviso no topo do site, contato (WhatsApp, Instagram)
- **Identidade visual** — 8 paletas prontas e ajuste fino de 4 cores
  (destaque, títulos, detalhes, fundo) com prévia ao vivo
- **Nossa história** — título, frase, texto e foto
- **Rodapé** — frase e opção de mostrar ou esconder os preços

O pedido do cliente chega **montado no WhatsApp**: itens, quantidades, escolhas do bolo
discriminadas e total.

## Como rodar

Precisa de Node 18.17+.

```bash
npm install
cp data/menu.exemplo.json data/menu.json   # catálogo de exemplo
npm start
```

- Site: <http://localhost:8092>
- Painel: <http://localhost:8092/admin>

Na primeira execução o painel gera uma **senha inicial** e grava em
`data/SENHA-INICIAL.txt` (apague depois de guardar). Para trocar a senha depois,
use a aba **Conta** dentro do painel.

Variáveis de ambiente:

| Variável   | Padrão              | Para quê                          |
|------------|---------------------|-----------------------------------|
| `PORT`     | `8092`              | Porta do serviço                  |
| `BIND`     | `0.0.0.0`           | Interface de escuta               |
| `DATA_DIR` | `./data`            | Onde ficam os dados e as imagens  |
| `ADMIN_USER` | `admin`           | Usuário do painel                 |

## Estrutura

```
server.js          rotas do site, do painel e da API
lib/store.js       leitura/escrita do catálogo (JSON, escrita atômica)
lib/auth.js        login com scrypt, sessões em disco, rate-limit
lib/images.js      upload com validação por magic bytes + reencode com sharp
public/index.html  site público (HTML + CSS + JS num arquivo só)
admin/index.html   painel (HTML + CSS)
admin/admin.js     lógica do painel
data/              catálogo, credenciais e imagens (fora do Git)
```

O catálogo é um **único JSON**. Backup é copiar a pasta `data/`. Não há banco de dados —
para uma loja com dezenas de itens e um único editor, isso é suficiente e elimina uma
peça para dar errado.

## Identidade visual

O cliente escolhe **4 cores** e o site deriva o resto (tom escuro do destaque, fundos
claros, borda, sombra e o gradiente do topo), para ele não precisar acertar dez
variáveis na mão. O contraste do texto sobre cada cor é calculado automaticamente.

A imagem do topo tem três modos, porque **logo não é foto de fundo**:

| Modo        | Para quê                                          |
|-------------|---------------------------------------------------|
| `preencher` | Foto de fundo que cobre a tela (corta as bordas)   |
| `inteira`   | Foto de fundo mostrando a imagem toda              |
| `logo`      | Logo da marca inteiro, sem cortar e sem escurecer  |

## Segurança

- Senha com `scrypt` + salt; sessões persistidas em disco (reiniciar não desloga)
- Rate-limit no login (6 tentativas por 15 min)
- Toda rota de escrita exige token de sessão
- Upload validado por **conteúdo** (magic bytes), não pela extensão; reencode com sharp
  remove metadados e limita o tamanho
- Caminhos de arquivo resolvidos e conferidos contra o diretório permitido
  (bloqueia `../` no caminho)
- Conteúdo do catálogo é escapado na renderização

## O que NÃO está no repositório

`data/menu.json`, `data/auth.json`, `data/sessions.json`, `data/uploads/` e
`data/backups/` ficam fora do Git — são dados do cliente e segredos. O
`data/menu.exemplo.json` é o catálogo de demonstração, com contatos fictícios e
imagens de banco público.
