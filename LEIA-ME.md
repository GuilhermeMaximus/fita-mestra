# Fita Mestra — fichas e overlay OBS

Painel estático em JavaScript, com autenticação, PostgreSQL e Storage no Supabase. A versão 2 preserva rascunhos por personagem/campanha, sincroniza os dados e detecta conflitos antes de gravar.

## Interface Fita Mestra

A navegação segue as tarefas do usuário:

- **Sessão:** ajustar vida e escolher o retrato que entra em cena.
- **Ficha:** editar nome, vida máxima e anotações.
- **Retratos:** enviar imagens por estado. O upload salva imediatamente; a escolha do retrato em cena é separada.
- **OBS:** copiar o link, seguir a configuração de 490 × 320 e personalizar texto.
- **Configurar campanha:** escolher entre as sete barras, ajustar cores e administrar participantes.

**Salvar alterações** grava os campos modificados de todas as abas do personagem. **Salvar aparência** é independente e vale para toda a campanha. Rascunhos são mantidos em memória ao trocar abas ou personagens; não sobrevivem ao fechamento da página. A interface avisa antes de sair com alterações.

A interface abre diretamente, sem introdução nem imagem decorativa na entrada. **Reduzir animações** controla as transições discretas e guarda a preferência neste navegador; a preferência do sistema também é respeitada. Não há iluminação do cursor nem dependência de Three.js.

As decisões e referências da remodelação estão em [DESIGN.md](DESIGN.md).

Para experimentar com dados fictícios, sem conectar ao Supabase:

```sh
pnpm build
pnpm demo
```

Abra `http://127.0.0.1:4174`. O mock persiste as alterações salvas em `.local-test/data.json` e oferece perfis de mestre/jogador, cadastro fictício, convites, administração, upload e OBS. A barra de teste permite trocar de perfil e restaurar os exemplos. Não há autenticação nem envio de e-mails reais. Para integração real, use um projeto Supabase separado e `pnpm start` na porta 4173. O passo a passo está em [TESTES.md](TESTES.md).

## Desenvolvimento e publicação

Requisitos: Node.js 24 e pnpm 11.25.0. As dependências têm versões exatas e integridade registrada em `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm start
```

A prévia abre em `http://127.0.0.1:4173`. Publique **somente o conteúdo de `dist/`** no Cloudflare Pages. Os módulos são empacotados localmente; o navegador não depende de um CDN de JavaScript. Não publique os fontes, testes, scripts administrativos ou `node_modules/`.

`config.js` contém somente a URL do projeto e sua chave pública. O projeto configurado é `zitejgylhdowkftqtffy`. Nunca coloque uma chave administrativa nesse arquivo. As configurações de cache e segurança do Cloudflare estão em `_headers`; se usar outro host, configure cabeçalhos equivalentes. Em domínios personalizados do Supabase, ajuste `connect-src`.

## Atualização de uma instalação existente

1. Faça um backup do banco e programe a atualização sem edições simultâneas.
2. No SQL Editor do projeto Supabase correto, execute **somente** `supabase/migrations/202610170001_reliability.sql`.
3. Publique o novo `dist/` e atualize os painéis abertos.
4. Configure a rotina de limpeza descrita abaixo.

**Não reaplique `supabase/schema.sql` sobre um banco atualizado.** Esse arquivo é a base v1 para instalação nova; ele contém permissões anteriores e poderia desfazer parte da atualização.

A migração é transacional, preserva fichas e campanhas e pode ser reaplicada. Ela adiciona versões de registros, validações, funções de salvamento, renovação de links, administração de participantes e fila de limpeza. O histórico fica em `public.schema_migrations`.

As novas restrições verificam os dados existentes. Se houver dados antigos inválidos, o PostgreSQL rejeitará a migração inteira e informará a restrição; nada é truncado ou corrigido silenciosamente. Corrija os registros após revisão e execute novamente. A migração parte das tabelas da base v1 deste repositório; instalações com outras alterações devem ser comparadas com a base primeiro.

## Instalação em banco novo

Execute `supabase/schema.sql` e depois `supabase/migrations/202610170001_reliability.sql`, nessa ordem. Configure `config.js`, faça o build e publique `dist/`.

## Comportamento de edição

- Alterações no formulário ficam em rascunhos em memória, associados ao ID. Trocar de personagem/campanha não perde esses rascunhos. Fechar/recarregar a página ainda os descarta; o navegador avisa quando existem alterações pendentes.
- Upload salva a imagem imediatamente e preserva os outros campos. O destino é fixado ao iniciar o envio. A seleção do estado ativo só é persistida ao salvar a ficha.
- O painel consulta atualizações a cada cinco segundos, depois que a consulta anterior termina. Dados remotos de campos não editados são incorporados. Campos editados localmente são preservados.
- O salvamento envia os campos alterados e seus valores originais. O banco bloqueia o registro durante a comparação e gravação. Alterações simultâneas em campos diferentes são combinadas; conflitos no mesmo campo exigem uma escolha explícita.
- O usuário pode escolher a versão do servidor ou manter seu rascunho sobre a versão atual e salvar novamente.
- Falhas ou perda de conexão durante uma gravação podem deixar seu resultado incerto. A próxima sincronização reconcilia os dados. Antes de repetir uma criação após erro de rede, confira a lista para evitar criar uma segunda ficha/campanha.

## OBS

Adicione o link individual como Fonte de Navegador de **490 × 320**. A prévia e o OBS usam o mesmo renderer e CSS. Nomes muito longos ficam limitados a 144 px de altura. Fontes dependem da disponibilidade no computador que executa o OBS.

O overlay faz uma consulta por vez, com intervalo de dois segundos após cada resposta. Falhas temporárias mantêm a última imagem e exibem aviso de reconexão. Uma resposta que indica personagem removido ou token revogado limpa a exibição. Renovar o link invalida o anterior; substitua a URL no OBS.

As imagens são públicas no Storage. Revogar o token revoga o acesso ao endpoint do overlay; não transforma URLs já compartilhadas de imagens em URLs privadas. Exclusão física dos arquivos ocorre na limpeza, e caches externos podem conservar cópias.

## Contas e participantes

Em Supabase Auth → URL Configuration, configure a URL do site e permita a URL exata de retorno `https://SEU-SITE/index.html` (também o endereço local, se precisar testar recuperação). Configure o envio de e-mails no Supabase. O painel oferece recuperação de senha por e-mail e formulário para definir a nova senha.

O mestre pode renovar o convite e remover participantes; jogadores podem sair. As fichas do participante que sai passam para o mestre. **Todos os tokens OBS e o convite da campanha são renovados**, pois todos os participantes podiam conhecer esses links. Atualize as fontes do OBS após a operação. O mestre não pode sair da própria campanha; transferência de propriedade da campanha não faz parte deste fluxo.

## Limpeza de retratos

A migração cria `portrait_gc`. Substituir uma imagem ou excluir um personagem enfileira os objetos antigos. Um worker verifica se continuam sem referências e remove os arquivos pela **API do Storage**; nunca exclui diretamente a tabela interna `storage.objects`.

Uploads que não chegaram a ser associados a uma ficha entram na coleta após 24 horas. Arquivos em uso são protegidos e arquivos já reclamados pela limpeza não podem ser anexados durante a exclusão. Falhas ficam registradas em `last_error`, com tentativas em `attempts`; podem ser tentadas novamente depois de dez minutos.

No ambiente administrativo, defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` como variáveis secretas e execute:

```sh
pnpm cleanup
```

O worker processa até 100 objetos por execução. Para execução automática, o workflow `.github/workflows/cleanup.yml` roda a cada hora em um repositório GitHub com Actions habilitado. Cadastre esses dois nomes em **Settings → Secrets and variables → Actions**. Também há disparo manual. Sem GitHub, agende o mesmo comando em um servidor. A rotina não fica ativa apenas por publicar o site: ela precisa do agendamento e das credenciais administrativas no servidor.

## Estrutura

- `src/app.js`: controlador da interface e integração dos fluxos.
- `src/navigation.js`: abas acessíveis, telas, formulários de entrada e diálogo de campanhas.
- `ui.js`: preferências de movimento e transições da interface.
- `src/mock-client.js` e `scripts/mock-store.js`: adaptador e banco persistente do ambiente local de teste.
- `src/model.js`: rascunhos, conflitos, controle de respostas e validações.
- `src/api.js`: acesso ao Supabase e upload.
- `src/client.js`: cliente com tempo máximo de requisição.
- `src/poll.js`: consultas sequenciais e tratamento do estado do overlay.
- `shared.js`: modelos, fontes e renderização comum.
- `src/cleanup.js` e `scripts/cleanup.js`: worker administrativo.
- `tests/`: regressões de interface, modelo e PostgreSQL.

## Verificação

Os testes de banco usam PostgreSQL local via PGlite, com tabelas de Auth/Storage simuladas e papéis `anon`, `authenticated` e `service_role`. Executam a base e a migração reais; apenas a geração de bytes aleatórios da extensão pgcrypto é substituída no fixture. Isso valida SQL, RLS, conflitos e revogações sem acessar o banco remoto, mas não substitui um teste de instalação no Supabase real.

O workflow `.github/workflows/check.yml` executa sintaxe, testes e build. As imagens originais foram preservadas. As sete barras em `assets/optimized/` usam WebP lossless, verificado pixel a pixel. A arte VHS usa WebP com qualidade 88 (aproximadamente 249 KiB). Para regenerar, instale Pillow e execute `python scripts/optimize-assets.py`.

O teste opcional `tests/browser-smoke.cjs` usa Playwright e Edge instalado. Execute `node tests/browser-smoke.cjs` com Playwright disponível, ou defina `PLAYWRIGHT_MODULE` para o diretório de uma instalação existente. O teste inicia seu próprio servidor, intercepta todo o tráfego Supabase e salva capturas em `test-results/`; não usa contas reais. `BROWSER_CHANNEL` permite escolher outro canal do Chromium. O roteiro também verifica a escala da prévia no celular.

O código local não inclui credenciais administrativas. A migração, o agendamento de limpeza, as configurações de e-mail e a publicação precisam ser aplicados no ambiente de hospedagem para ativar a versão 2.
