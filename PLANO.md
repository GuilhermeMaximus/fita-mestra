# Correções da revisão

- [x] Separar dados remotos, seleção e rascunhos por ID. Invalidar respostas antigas ao trocar campanha ou usuário. Preservar edições durante uploads e sincronização.
- [x] Gravar alterações com comparação dos campos originais dentro de uma transação no banco. Detectar conflitos sem descartar rascunhos. Bloquear operações duplicadas.
- [x] Compartilhar renderização e estilos entre prévia e OBS. Serializar consultas, recuperar erros e limpar overlays removidos.
- [x] Versionar a atualização do banco, validar aparência e campos, permitir renovação de links e administração de membros. Corrigir permissões após saída/remoção.
- [x] Implementar fila persistente e worker pela API do Storage, com workflow de agendamento, para retratos substituídos/excluídos e uploads abandonados.
- [x] Adicionar recuperação de senha, administração de campanha, acessibilidade, dependências fixadas e imagens otimizadas.
- [x] Validar com testes de regressão JavaScript e PostgreSQL local, build e verificação da interface. Documentar instalação, migração e operação da limpeza.

## Entrega

As alterações remotas dependem da aplicação da migração no projeto Supabase e da publicação de `dist/`. O projeto local não contém credenciais administrativas para executar essas etapas automaticamente. Não executar o schema inicial sobre uma instalação existente.

## Verificação local

- 27 testes aprovados, incluindo interface em DOM, concorrência e PostgreSQL/RLS.
- Sintaxe e associações de rótulos verificadas.
- Build em `dist/` gerado com dependências locais fixadas.
- Teste no Edge com respostas de rede simuladas: login, rascunhos durante sincronização, salvamento, layout móvel, carregamento de imagens e revogação do overlay.
- Molduras WebP sem perda: 3.349.296 bytes, contra 5.506.995 bytes nos originais; pixels RGBA idênticos.

## Ativação no ambiente hospedado

- [ ] Aplicar a migração no Supabase real.
- [ ] Configurar URL de retorno e envio de e-mail para recuperação de senha.
- [ ] Configurar credenciais administrativas no agendador de limpeza.
- [ ] Publicar o conteúdo de `dist/` e conferir os fluxos com contas reais.
