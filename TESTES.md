# Testar Fita Mestra sem afetar produção

## Qual ambiente usar?

| Ambiente | Serve para | Limite |
| --- | --- | --- |
| Mock local persistente | Interface, campanhas, convites, participantes, retratos, conflitos e OBS | Simula regras; não valida JWT, RLS/PostgreSQL, e-mails ou Storage reais |
| Supabase de homologação | Teste integrado de autenticação, banco, Storage e permissões reais | Exige um projeto Supabase separado e configuração inicial |
| Testes automatizados | Regressões de interface, modelo, mock e SQL/RLS com PGlite | Não substituem a integração real de Auth e Storage |

Comece pelo mock para usar as funcionalidades agora. Antes de publicar, valide no Supabase de homologação.

## 1. Mock local pronto

No diretório do projeto:

```powershell
pnpm build
pnpm demo
```

Abra **http://127.0.0.1:4174**. Não precisa de conta Supabase, Docker ou chave de API.

Se aparecer **porta 4174 já está em uso** (`EADDRINUSE`), verifique se o site já está aberto nesse endereço. Basta usar o servidor existente; não execute `pnpm demo` uma segunda vez. Para reiniciar, use `Ctrl+C` no terminal que iniciou o servidor e rode o comando novamente. Mantenha apenas um servidor mock por projeto, pois ele grava os dados no mesmo arquivo local.

- A barra **Testar como** alterna entre `mestre@exemplo.com` e `jogador@exemplo.com`.
- O jogador é dono de Dorian Ash; Lyra e Mira pertencem ao mestre.
- Use **Campanhas** para criar uma mesa ou entrar com um convite válido.
- Contas fictícias adicionais podem ser criadas na tela de cadastro. Não há autenticação real: qualquer senha fictícia de seis ou mais caracteres satisfaz o formulário, mas não é enviada ao servidor nem armazenada.
- Cadastro/login são simulações. Recuperação de senha e envio de e-mail mostram uma mensagem explicando que exigem Supabase real.
- As alterações salvas ficam em `.local-test/data.json`, ignorado pelo Git e fora da pasta publicada. Sobrevivem a recarregamentos e reinícios do servidor.
- Retratos de até 5 MB são armazenados nesse arquivo em base64. É uma solução de teste; use arquivos pequenos.
- **Restaurar dados de teste** pede confirmação e substitui somente os dados locais pelos exemplos iniciais.
- A identidade é mantida por aba. Para testar concorrência, abra outra aba e escolha um perfil; ambas usam o mesmo banco local.
- Rascunhos não salvos continuam apenas na memória da página. Clique em **Salvar alterações** antes de recarregar.

O link do OBS usa o mesmo servidor HTTP local. Pode ser aberto em outra aba ou no OBS do mesmo computador, mesmo com o painel fechado. Mantenha `pnpm demo` rodando. Um link com `127.0.0.1` não funciona em outro computador.

O servidor atende apenas no endereço local, não habilita CORS e rejeita origens diferentes. Não publique esse simulador: ele permite selecionar identidades sem senha por design. Publique somente `dist/` com configuração Supabase.

## 2. Supabase real de homologação

1. Crie um projeto Supabase separado, por exemplo **fita-mestra-test**. Não use as credenciais de produção.
2. No SQL Editor desse projeto novo e vazio, execute `supabase/schema.sql`.
3. Em seguida, execute `supabase/migrations/202610170001_reliability.sql`. Em um projeto já atualizado, não reaplique a base inicial.
4. Copie `config.test.example.js` para `config.test.js`. Preencha com a URL HTTPS e a chave pública **publishable/anon** do projeto de teste. Nunca use `service_role` ou secret key no navegador.
5. Em Auth → URL Configuration, configure o endereço local e permita o retorno `http://127.0.0.1:4173/index.html`. Configure o envio de e-mails para testar confirmação e recuperação.
6. No PowerShell, gere um build usando essa configuração:

```powershell
$env:FITA_CONFIG_FILE = 'config.test.js'
pnpm build
Remove-Item Env:FITA_CONFIG_FILE
pnpm start
```

Abra **http://127.0.0.1:4173**. A porta 4173 usa a configuração do build; a porta 4174 sempre força o mock e nunca acessa Supabase.

Para gerar novamente com a configuração habitual, rode `pnpm build` sem a variável `FITA_CONFIG_FILE`. Alterações no arquivo de configuração só entram depois de um novo build.

O arquivo `config.test.js` está ignorado pelo Git. Sua chave pública será incluída em `dist/config.js`, como é esperado para uma aplicação de navegador. Quem protege os registros é a autenticação junto das políticas RLS, não o sigilo dessa chave.

## Roteiro de integração

- Criar duas contas de teste e confirmar os e-mails.
- Como mestre, criar uma campanha e copiar o convite.
- Em outra sessão do navegador, entrar como jogador e aceitar o convite.
- Criar uma ficha com cada conta; confirmar as permissões de edição.
- Enviar um retrato e confirmar a existência do arquivo no Storage.
- Copiar o link OBS e conferir vida/retrato após salvar.
- Editar o mesmo campo simultaneamente; verificar a resolução de conflito.
- Renovar um link e conferir que o anterior deixa de funcionar.
- Remover o jogador; conferir transferência das fichas e revogação dos links.
- Testar recuperação de senha e o retorno ao site.

Para quem prefere tudo no computador, o Supabase também oferece uma stack local com CLI e Docker. A instalação e o provisionamento dessa stack não foram executados nesta tarefa. Este repositório tem a base v1 fora da pasta de migrations: não execute um `db push`/reset às cegas presumindo que só a migração v2 inicializa um banco vazio.

## Testes automatizados

```powershell
pnpm check
pnpm test
```

Os testes do mock usam diretórios temporários próprios; não restauram nem alteram `.local-test/data.json`.

Referências oficiais: [Supabase local development](https://supabase.com/docs/guides/local-development), [CLI e requisitos](https://supabase.com/docs/guides/local-development/cli/getting-started), [testes de banco e RLS](https://supabase.com/docs/guides/database/testing).
