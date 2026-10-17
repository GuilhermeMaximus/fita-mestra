# Fita Mestra — remodelação da experiência

Implementação local em 17/10/2026. Atualização: a introdução e a arte decorativa foram removidas a pedido do usuário; a entrada atual usa somente texto e controles. O ambiente de teste agora persiste os dados em disco (ver TESTES.md). A direção mantém retrowave: fundo ameixa escuro, rosa como ação principal, ciano para orientação e tipografia de vídeo analógico em pequenos detalhes. O nome público é **Fita Mestra**.

## Diagnóstico e decisões

| Problema observado | Decisão implementada | Efeito esperado |
| --- | --- | --- |
| Criar/entrar em campanhas disputa espaço com o trabalho de uma sessão | Navegação lateral com campanha e elenco; criação/convite em diálogo | Entrar direto no personagem selecionado |
| Muitos campos e configurações apresentados simultaneamente | Abas Sessão, Ficha, Retratos e OBS | Mostrar primeiro os controles mais frequentes |
| Vida e salvamento ficam separados por muito conteúdo | Vida grande, atalhos ±1/±5 e barra de salvar persistente | Ajustar e confirmar sem procurar o botão |
| Não está claro o que chegou à transmissão | Prévia identificada como rascunho ou salva; status explícito | Distinguir edição local de atualização enviada |
| Seleção de retrato mistura envio de arquivo e ativação | Galeria escolhe o destino do upload; Sessão escolhe a variação ativa | Evitar trocar o retrato ao preparar um arquivo |
| Nomes das barras exigem imaginar a aparência | Miniaturas das sete molduras reais com seleção visível e prévia de preenchimento | Reconhecer visualmente o modelo desejado |
| Configuração do OBS aparece junto de tarefas de jogo | Instruções em três passos, copiar link e dimensões explícitas | Configurar a transmissão num fluxo próprio |
| Administração e ações destrutivas competem com tarefas comuns | Configuração de campanha separada; ações avançadas recolhidas | Diminuir escolhas irrelevantes e cliques acidentais |
| Campos vazios não orientam o início | Estados vazios com ação direta para campanha/personagem | Indicar o próximo passo |
| Movimento permanente compete com a leitura | Entrada direta, transições curtas e opção de reduzir animações | Manter personalidade sem distração contínua |
| Sincronização reconstrói controles com foco | Reconciliação estável de seletores, barras e galeria | Preservar navegação por teclado durante consultas |

## Fluxos principais

1. **Começar:** criar conta/entrar → criar campanha ou colar convite → criar personagem → preencher Ficha.
2. **Jogar:** escolher personagem → Sessão → ajustar vida/retrato → Salvar alterações.
3. **Preparar imagens:** Retratos → escolher estado → enviar arquivo → Sessão → selecionar estado → salvar.
4. **Transmitir:** OBS → copiar link → fonte Navegador no OBS → 490 × 320.
5. **Personalizar a mesa:** Configurar campanha → escolher moldura/cores → Salvar aparência.

O salvamento é explícito para preservar a revisão de conflitos. Campos das abas do personagem são salvos juntos; aparência de campanha tem seu próprio salvamento. A permissão de mestre/jogador e as garantias de concorrência permanecem no modelo/API/banco.

## Arquitetura e acesso

- `src/navigation.js` concentra navegação e semântica de abas, sem conhecer Supabase nem apagar rascunhos.
- `src/app.js` coordena o estado e permissões; `src/model.js` continua responsável pelos rascunhos/conflitos.
- `shared.js` mantém um renderer comum para monitor e OBS.
- Diálogos nativos oferecem isolamento de foco e Escape; abas usam setas, Home/End e tabindex móvel.
- Rótulos associados, foco visível, contraste alto nos controles, layout responsivo e erros dentro do diálogo ativo.
- A estética não depende de fontes remotas, biblioteca 3D ou rastreamento do cursor.

## Entrada simplificada

A versão atual abre diretamente, sem animação de introdução, botão de replay ou imagem decorativa. A identidade retrowave fica na paleta e na tipografia. As imagens de barras e os retratos funcionais permanecem. A arte VHS anterior está preservada no projeto como histórico, mas não é carregada pela interface.

## Barras

Foram encontrados sete originais PNG no diretório local: Gótico, Pixel Art, Arco-íris, Steampunk, Dark, Floresta e Céu. Todos aparecem na interface. Novas molduras exigem cadastro em `shared.js`, encaixe validado e atualização da lista permitida no banco; acrescentar somente um arquivo não basta.

## Fundamentação

- [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): base para revelar configurações secundárias sob demanda.
- [Nielsen Norman Group — Recognition and Recall](https://www.nngroup.com/articles/recognition-and-recall/): base para miniaturas e opções identificáveis.
- [Nielsen Norman Group — 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): status, controle do usuário, consistência e prevenção de erros.
- [W3C — Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): semântica e interação por teclado.
- [W3C — Dialog Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): diálogo e foco.
- [W3C — prefers-reduced-motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html): redução de movimento por preferência do usuário.

São decisões orientadas por heurísticas e verificadas em implementação. Não representam uma pesquisa com usuários nem uma certificação de acessibilidade.

## Verificação

42 testes automatizados passaram, incluindo os testes anteriores de concorrência, RLS e banco local. As regressões cobrem navegação sem perda de rascunho, foco durante sincronização, separação entre upload e retrato ativo, erros em abas ocultas, estados vazios, diálogo, formulários de autenticação, ausência da introdução e persistência/permissões do mock.

Inspeção no navegador integrado: desktop e celular, controle de vida, edição entre abas, salvamento, seleção de barras, cópia do link, criação de campanha por Enter, início de ficha e telas de autenticação. Evidências em `design-review/`.

Build em `dist/`. O ambiente local usa dados fictícios persistidos em .local-test/data.json; autenticação e e-mails reais exigem Supabase de homologação. Nenhuma campanha real foi modificada e nenhuma publicação remota foi feita. Esta remodelação não exige alteração do esquema do banco, além da migração de confiabilidade já documentada para instalações antigas.
