# Guia de Playtest — Origens (G2)

Guia rápido para validar a primeira era jogável (**Origens**) antes de preencher a rubrica em [`docs/RUBRIC-FORM.md`](RUBRIC-FORM.md).

---

## 1. Ambientes de teste

1. **Desktop — WebGPU** (padrão em Chrome/Edge modernos): abrir a URL sem parâmetros extras.
2. **Desktop — WebGL2** (fallback): adicionar `?webgl` na URL e comparar iluminação, sombras, suavidade e tempo de carregamento.
3. **Mobile real — WebGL2** (retrato e paisagem): abrir no celular na rede real (Wi-Fi e 4G/5G), observar aquecimento, bateria, legibilidade do HUD em retrato e fluidez com um polegar.

---

## 2. Controles

| Ação | Desktop | Mobile (touch) |
|---|---|---|
| Mover | `WASD` ou Setas (resposta imediata, sem tela de bloqueio) | Joystick virtual (1 polegar) ou **tap-to-walk** (toque no terreno para caminhar até o ponto) |
| Câmera | Arrastar com o botão do mouse para orbitar; roda do mouse para zoom | Arrastar com 1 dedo na área livre da tela / pinça para zoom |
| Pular / Planar | `Espaço` (segurar no ar para planar) | Botão de salto (segurar para planar) |
| Carimbar (Stamp) | `Espaço` + `Shift` / `E` no ar (ou botão de carimbo) | Botão de carimbo no ar |
| Interagir | `F` próximo a marcos e blocos | Toque no prompt contextual próximo ao marco |
| Pausar | `P` (congela física, partículas e áudio ambiente; libera cursor) | Botão de pausa no HUD |
| Lista de marcos | Botão **Marcos** no HUD -> clicar **"Ir até"** em qualquer cartão | Botão **Marcos** -> **"Ir até"** |

---

## 3. O que testar em Origens

Percorra a era por pelo menos **5 minutos** verificando:

1. **Primeiros 10 segundos e fluidez**:
   - Spawn livre em Origens, sombra de contato e movimento imediato com `WASD`/toque.
   - 20 sinais colecionáveis espalhados pela era (17 visíveis + 3 secretos) e contador `Sinais X/20` no HUD.
2. **Os 3 marcos principais (Set Pieces)**:
   - **1994 — Casa / Ipê**: aproximar-se ou encostar no bloco `1994` (ou pressionar `F`). A casa se desdobra em pop-up, o ipê floresce com confetes e abre o cartão `e-1994-09`.
   - **2005 — CRT Ponto Interativo**: ir até o monitor CRT e carimbar o botão de energia (ou pressionar `F`). A tela acende com o Ponto Interativo e abre o cartão `e-2005-01`.
   - **2011 — Escola / Capelo**: aproximar-se do bloco `2011` e pressionar `F`. O capelo faz voo parabólico até a cabeça do Victor e abre o cartão `e-2011-12`.
3. **Segredo — Cupinzeiro (Secret Termite Mound)**:
   - Localizar o cupinzeiro secreto, pular e carimbar em cima dele. Deve abrir, revelar os **3 sinais ocultos** e exibir o console retrô.
4. **Line Grind**:
   - Pular e aterrissar sobre a **Linha** dourada. O personagem entra em *grind* automático com faíscas e som metálico; testar salto a partir da Linha para ganhar impulso extra.
5. **Contact Pipe -> End-Dot**:
   - Seguir até o final da Linha, entrar no **cano de contato** e conferir a transição/chegada ao **ponto final (End-Dot)** da fatia.
6. **HUD, Lista de Marcos e Acessibilidade**:
   - Abrir a lista de marcos, usar **"Ir até"** para navegar até um marco distante, testar pausa (`P`) e verificar se não há cortes ou sobreposições no modo retrato.

---

## 4. Registro da avaliação

Após jogar, preencha uma cópia do formulário em [`docs/RUBRIC-FORM.md`](RUBRIC-FORM.md) anotando aparelho, navegador, rede e suas impressões por dimensão.
