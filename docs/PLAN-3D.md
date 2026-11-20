# Linha do Tempo 3D: plano de reconstrução (reset da fundação)

Repositório: `D:\GitHub\_kit-clones\timeline` (origin `voaneves/timeline`, GitHub Pages legado a partir da raiz de `main`, URL `https://voaneves.github.io/timeline/`).
Data: 2026-11-20. Base atual: commit `02b6260` (rodada 4: portais de era, base da fita, água/folhagem, camadas de áudio). Medido a 75 fps na RX 6750 XT em 1280×720.
Status: só plano. Nada daqui foi implementado.

Meta do dono: "11/10, onde o bruno-simon.com é 10/10", **também no celular**. Nota atual dada pelo dono depois de jogar: **2/10 no máximo**.

Direção técnica (pedido do dono): construir **sobre o código aberto do Bruno Simon** (`brunosimon/folio-2025`, licença MIT, "Copyright (c) 2025 Bruno Simon") como base de engenharia. Em cima disso, superar o original com **tudo o que se vê e se ouve 100% original**.

Sumário:
0. Fatos verificados (leitura do código e medições)
1. Diagnóstico: por que o build atual é 2/10
2. Visão e direção criativa para 11/10
3. Jogabilidade e controles
4. Level design
5. Pipeline de arte
6. Arquitetura técnica (reuso do motor folio-2025, fronteira de originalidade, repo e deploy)
7. Gates de qualidade e avaliação (nova rubrica)
8. Roadmap com tarefas numeradas
9. Riscos, mitigações e decisões do dono
10. Definição de 11/10 (checklist)

---

## 0. Fatos verificados

### 0.1 Build atual (`02b6260`)

| Área | Fato | Onde |
|---|---|---|
| Física | Corpo AABB contra caixas estáticas, resolução separada por eixo e chão plano em `y = 0` (`if (b.y <= 0)`). Não tem rampa, degrau nem colisão com malha. | `src/world/physics.js` |
| Controle | Entrada em eixos de **tela**, não relativa à câmera (`s.x`, `s.z`). `maxv 7.2`, aceleração 75 no chão e 45 no ar, `vy` do pulo 15.2, gravidade 38 (×1.45 na queda), coyote 0.1 s, buffer 0.12 s. | `src/world/main.js` l. ~1080–1110 |
| Câmera | Yaw fixo, pitch 23°, distância 14, FOV 36, amortecimento 0.28 e look-ahead de 0.3 × velocidade. O avatar ocupa cerca de 1/8 da altura da tela. Intro em grua de 3.8 s. | `src/world/camera.js` |
| Render | `WebGLRenderer` + ACES, sombra PCFSoft de 2048², EffectComposer (MSAA RT → Unreal bloom → grade com god rays, vinheta e blur). | `renderer.js`, `post.js` |
| Material | Toon de 4 degraus + contorno por casco invertido em tudo, mais grama em lâminas com shader próprio. | `materials.js`, `terrain.js` |
| Avatar | Primitivas (esferas e caixas arredondadas), sem esqueleto. Animação procedural por código. | `avatar.js` |
| Som | Síntese WebAudio (bipes, ruído) mudo por padrão, sem música. | `sfx.js` |
| Tamanho | Chunk do mundo `assets/js/world/world.min.js` = **181 KB gz**. 2D: Lighthouse 100×4. | medido |
| Arquivo-deus | `main.js` com 1.4 mil linhas mistura layout, regras, UI e loop. | `src/world/main.js` |

### 0.2 Motor folio-2025 (lido de um clone temporário no commit `70764a9`, 2026-11-04; o clone durável `D:\GitHub\_vendor\folio-2025` é criado na T0.3)

| Item | Fato |
|---|---|
| Licença | MIT, `license.md` "Copyright (c) 2025 Bruno Simon". (O `package.json` declara "ISC", mas o que vale é o `license.md`, MIT.) O site credita mr.doob/Sunag (three/TSL), Kounine (música CC0), Rapier, Howler e as fontes Amatic SC e Nunito. |
| Render | `three/webgpu` + TSL (`WebGPURenderer`, com fallback automático para WebGL2), `RenderPipeline` com bloom (TSL) e `cheapDOF`. `Quality.level`: 0 no desktop, 1 no celular, escolhido pelo user agent. |
| Visual | **Não é luz bakeada.** A paleta é uma textura (`palette.ktx`, filtro nearest), e cada malha aponta as UVs para um swatch. `MeshDefaultMaterial` (Lambert em TSL) faz sombra de núcleo por `smoothstep(N·L)`, cor de sombra tingida, "light bounce" com a cor do terreno, sombra projetada de 1 shadow map (2048 no nível 0, 512 no nível 1), névoa e "reveal" (dissolve radial). Ciclos de dia e ano interpolam os presets de luz. |
| Física | `@dimforge/rapier3d` (^0.19.3, **não-compat**, wasm separado via `vite-plugin-wasm`), importado em paralelo aos assets. O jogador é **um veículo** (`world.createVehicleController`). **Não existe** controlador de personagem a pé (nenhum uso de `KinematicCharacterController`). |
| Loop | `Ticker` com prioridades numeradas (0 entrada → 3 física → 7 view → 10 mundo → 14 áudio → 998 render). Singleton `Game.getInstance()`. |
| Conteúdo | Um `areas.glb` cujos filhos têm prefixo de nome (`career…`, `projects…`), cada um instanciando uma subclasse de `Area`. Empties `ref<Nome><n>` viram referências (`References.js`). Colisores vêm de filhos nomeados `trimesh*`, `hull*`, `cuboid*`, `cylinder*` e `ball*`, mais custom props (`mass`, `friction`, `restitution`, `category`). |
| Câmera | `View.js`: ponto de foco suavizado com ângulo esférico fixo (estilo isométrico), zoom, modo cinemático, linhas de velocidade e `camera-controls` só no modo livre/debug. |
| Entrada | `Inputs/` com Keyboard, Gamepad, Pointer, Wheel, `Nipple` (joystick de toque) e InteractiveButtons, num mapa de ações com filtros. |
| Áudio | `Audio.js`: wrapper de Howler com `register({path, loop, volume, antiSpam, onPlay, onPlaying})`, variação de `rate` e playlist de música. |
| Carga | **Tudo carrega de uma vez**, sem streaming por área. Só há culling por frustum de área. |
| Assets | GLB comprimidos: cerca de 1.1 MB. KTX: cerca de 3.2 MB. `static/sounds` = 151 MB de fonte, com nomes de bibliotecas comerciais (`Robotic_Lifeforms…`, `Source Stone Loop…`). |
| Extras de servidor | `Server.js` (WebSocket), Whispers, placar do circuito, BlackFriday, Easter/Christmas, Konami e Google Analytics (`gtag`) no `index.html`. |
| Deps | three ^0.187.0, rapier3d ^0.19.3, vite ^8.3.5, gsap ^3.15.1, howler ^2.2.4, camera-controls, tweakpane, stats-gl, stylus, msgpack-lite, uuid, seedrandom, glob, sharp, gltf-transform. Usa ranges `^`, o que fere a política de pin exato. |

### 0.3 Medições de peso (gzip -9, nesta máquina)

| Peça | Bruto | gz | Observação |
|---|---|---|---|
| `three/webgpu` + `three/tsl` (bundle esbuild com namespace) | 1.13 MB | **311 KB** | Teto superior; tree-shaking real deve ficar perto de 250 KB. |
| Rapier wasm (`rapier_wasm3d_bg.wasm` 0.21.0) | 3.08 MB | **1.17 MB** | O compat (base64 inline) dá 1.65 MB gz. |
| Basis transcoder (wasm + js) | 527 KB + 58 KB | **245 KB + 15 KB** | Necessário só para KTX2, que **fica fora da fatia** (6.5). |
| Decoder meshopt | 29 KB | 7.7 KB | Bem mais leve que Draco. |
| Chunk 3D atual | — | 181 KB | Para referência. |

Versões (npm, hoje): `three 0.187.0` (2026-10-30), `@dimforge/rapier3d(-compat) 0.21.0` (2026-09-25), `@gltf-transform/cli 4.5.1` (2026-09-28), `meshoptimizer 1.3.0`, `howler 2.2.4` (2023). Todas passam do resfriamento de 7 dias.
Ferramentas ausentes na máquina: **Blender** e **ffmpeg**. O **KTX-Software** só entra se a KTX2 voltar ao plano. Presentes: Node 26.13.0, Playwright 1.65.1, Python 3.12 e Chrome.

---

## 1. Diagnóstico: por que o build atual é 2/10

O problema não é falta de polimento. Faltou **autoria**. Tudo foi gerado por código com primitivas e foi avaliado por quadros estáticos. Ninguém jogou o controle antes de empilhar efeitos por cima dele.

### 1.1 Arte e cor
- **Quatro estilos brigando no mesmo quadro** (`desk-06-spawn.png`, `desk-10-block-bump.png`): avatar toon com contorno, grama em lâminas semi-realistas, pedras low-poly facetadas sem contorno e ciprestes-cilindro. Falta uma linguagem de forma.
- **Paleta lamacenta.** O grade "golden hour" (split tone + god rays em `post.js`) puxa tudo para amarelo-oliva. O vermelho de sinal da marca só aparece em bandeirinhas e confete. O creme da marca virou um "chão bege" sem papel.
- **Sombras duras gigantes** do sol baixo (`SUN_OFF (24.5, 11.8, −4.2)`, 25° de elevação) cruzam metade da tela e escurecem o caminho. Ficou bonito em frame estático e ilegível em jogo.
- **Sem bevel nem AO.** As peças são primitivas `BoxGeometry`/`CylinderGeometry`, e o que dá o "brinquedo premium" do Bruno é justamente bevel que pega luz mais contato escuro.
- **Texto no mundo como placa de papel** (`desk-16`, `desk-17`). Os rótulos boiam, cortam o avatar e ficam borrados pelo DOF.

### 1.2 Controles
- Entrada em eixo de tela com câmera de yaw fixo. Funciona na reta, mas o mundo é uma ilha aberta, e na curva da estrada (`roadZ`) "cima" deixa de ser "para frente".
- O pulo vai a cerca de 3.0 m de apex em 0.4 s com corpo de 1.5 m: **2× a altura do corpo, flutuante**. A queda a 1.45× não compensa. A aceleração de 75 com teto de 7.2 m/s dá resposta seca e sem curva, sem derrapagem nem inércia que se sinta.
- A colisão AABB sem rampa ou degrau faz o personagem "colar" em quinas. O chão é plano: o terreno "esculpido" é só visual.
- No toque, o joystick só aparece na metade esquerda e o pulo é um botão vermelho genérico (`mob-07`). Não dá para jogar com um polegar.

### 1.3 Câmera
- Distância 14 com FOV 36 deixa o avatar minúsculo e o horizonte domina. A suavização de 0.28 sem zona morta vertical faz a câmera "boiar" a cada pulo.
- Em retrato (`mob-07`) metade da tela é grama em primeiro plano. Não há enquadramento autoral por trecho.
- O dolly do card desloca a cena e aplica blur, e o mundo vira borrão (`desk-16`).

### 1.4 Level design
- **Corredor linear em +x** com um bloco a cada 7 unidades (`cx += 7`), moedas entre eles, e nada para fazer no meio. As eras se distinguem só pela cor do céu (`SKY_Z`).
- Não há marco visível de longe nem objetivo no horizonte, e o hub "Cruzamento" é um círculo bege com dois canos e uma placa.
- Os segredos (caixotes) não têm pista. Não há ritmo de tensão e recompensa.

### 1.5 Personagem
- Corpo de primitivas, olhos de 6 cm, sem boca nem expressão, sem esqueleto e sem clipes. A animação é soma de senos. A silhueta lê como "boneco de lego vermelho", não como o Victor.

### 1.6 Imersão, som e ritmo
- Mudo por padrão, sem música. Os sons sintetizados soam como bipes de protótipo.
- O HUD tem 7 elementos fixos (`0/15 marcos · 0/30 moedas`, zona, Projetos, Contato, mudo, ajuda, sair) e compete com a cena.
- Tela de título com card sobre o mundo, cortina, grua de 3.8 s: o visitante leva cerca de 6 s para ter controle.

### 1.7 Performance e processo
- 75 fps a 1280×720 numa RX 6750 XT é pouco para uma cena tão simples. A conta é bloom + grade de 12 taps + MSAA RT + sombra PCFSoft de 2048 + grama densa. Num celular médio isso seria 15–25 fps.
- As notas internas de 8–9/10 vieram de quadros headless parados. Não houve vídeo, playtest nem métrica de controle. **Esse processo de avaliação também é parte do reset** (seção 7).

---

## 2. Visão e direção criativa

### 2.1 A fantasia central

> **"Eu ando pela minha linha do tempo."**
> O mundo é a linha do tempo de Victor, desenhada a tinta vermelha sobre papel creme, e ela é literal: uma **fita vermelha contínua** (a Linha) sai do berço em Araguaína/TO, atravessa as cinco eras e termina no **ponto final** gigante da marca (o "." de `VOANEVES.`). Esse ponto é o contato.
> Assinatura: **"O ponto final é o começo da conversa."**

Por que é do Victor e não do Bruno:
- O Bruno dirige um carrinho num parque de diversões de portfólio. Aqui a pessoa **anda e pula dentro da biografia**, e cada marco é um evento físico (bater num bloco, ligar um monitor, pegar um capelo).
- Identidade brasileira concreta: cerrado tocantinense (terra vermelha de laterita, buriti, ipê-amarelo, pequi, cupinzeiro, seriema, Rio Tocantins), baião na trilha da era 1, campus, fábrica, dados.
- Identidade da marca: tinta (`#0a0a0a`), papel (`#f4ead4`), sinal (`#f50000`). O vermelho tem **um papel só**: a Linha, o ponto e o que é "sinal" (blocos de marco, a jaqueta do Victor). Nunca decoração aleatória.
- Homenagem retrô-platformer reinterpretada: canos de **cobre e tinta com anel de ponto vermelho** (longe do cano verde clássico; o verde fica como opção do dono, D15), blocos que se batem por baixo, pontos colecionáveis. Os blocos são de papel com um ponto vermelho em relevo. As moedas são "sinais", pequenos pontos vermelhos de tinta. Nada de personagem, som ou melodia reconhecível de terceiros.

### 2.2 Bíblia de direção de arte

**Conceito visual: "diorama de papel e brinquedo".** Formas de brinquedo de madeira/plástico macio com bevel generoso, materiais foscos, paleta chapada por textura (técnica do motor), AO de contato escuro e névoa de cor por era. Cada era é uma ilha-diorama com borda cortada, como uma página de livro pop-up apoiada na mesa. A borda mostra o "corte" do terreno em camadas: terra, rocha, papel.

**Linguagem de forma.**
- Volumes primários arredondados (raio de bevel de 8–15% da menor dimensão, 2–3 segmentos).
- Proporção "chunky": nada mais fino que 0.08 m na escala do personagem de 1.2 m.
- Formas orgânicas (árvores, nuvens) em blobs de 3–5 lóbulos. Formas humanas (prédios, máquinas) em caixas com quinas arredondadas.
- A Linha vermelha é a única forma "desenhada": uma fita contínua de 0.35 m de largura, levemente elevada (0.02 m) e com ondulação.

**Materiais.**
- Uma paleta de 16×16 swatches (`palette.png`, nearest). Fosco por padrão.
- Brilho só em três coisas: a Linha (leve emissivo + bloom no desktop), o ponto final (emissivo pulsante) e os blocos de marco ativos.
- Contorno a tinta **só** no personagem e nos interativos (casco invertido fino, 0.015 m). O mundo não leva contorno, e isso resolve a briga de estilos da seção 1.1.

**Paleta mestre** (decorativa, 3D). Texto nunca vai sobre ela sem o gate de contraste.

| Papel | Hex | Uso |
|---|---|---|
| Tinta | `#0a0a0a` | Contornos, detalhes, letreiros. Nunca área grande de dia. |
| Papel | `#f4ead4` / `#efe4c5` | Blocos de marco, nuvens, trilhas de pedra, bordas pop-up |
| Sinal | `#f50000` / `#ff2a2a` (emissivo) | Linha, ponto final, jaqueta do Victor, sinais colecionáveis |
| Cano | cobre `#b8733a` / sombra `#8a5228`, borda tinta `#0a0a0a`, anel sinal `#f50000` | Canos (homenagem reinterpretada, D15) |
| Tijolo | `#b5562c` | Blocos de tijolo, prédios UNICAMP |
| Ouro de ipê | `#f7c531` | Ipê, faixas de segurança da Indústria, faíscas |

**Luz e humor por era.** Os presets entram no sistema de ciclos adaptado (seção 6), interpolados pela posição do jogador ao longo da Linha, nunca pelo relógio.

| Era | Hora | Céu topo → horizonte | Luz (cor, int.) | Cor de sombra | Névoa | Terreno |
|---|---|---|---|---|---|---|
| 1 Origens (1994–2011) | Amanhecer | `#6fa8dc` → `#ffd9a8` | `#ffe2b8`, 1.05 | `#6a3d5c` | `#f2c9a0` | Laterita `#c4532d`/`#a8432a`, capim seco `#d6b85a`, verde cerrado `#9aa84a` |
| 2 UNICAMP (2012–2016) | Meio-dia | `#5fb3f0` → `#e3f4ff` | `#ffffff`, 1.15 | `#3d5a80` | `#dcefff` | Grama `#5fae4e`, concreto `#d9d2c3`, tijolo `#b5562c` |
| 3 Indústria (2017–2019) | Tarde âmbar | `#f29e4c` → `#ffe0b0` | `#ffd08a`, 1.0 | `#5b4a7a` | `#f6c99a` | Aço `#8d99a6`, esteira `#3a3f44`, faixa `#f2c230` |
| 3b Alemanha (ilha) | Tarde fria | `#9bb7d4` → `#eef3f8` | `#f4f7ff`, 0.95 | `#4a5670` | `#e6edf5` | Enxaimel creme e tinta, telhado `#a8432a` |
| 4 Dados (2019–2021) | Crepúsculo azul | `#2b6f8f` → `#9fd9d2` | `#cfe9ff`, 0.85 | `#1f3b57` | `#7fb8c4` | Barras papel/sinal/tinta, pontos de dados `#ffd75a` emissivos |
| 5 Transformação digital (2022–hoje) | Pôr do sol → noite quente | `#ff8a5c` → `#3b2a6b` | `#ffb48a`, 0.9 | `#3a2550` | `#c98aa0` | Praça de projetos, luzinhas `#ffd75a`, o ponto final emissivo |

**Painel de referências** (em palavras, sem copiar nada):
- A Short Hike: câmera próxima, ilha com objetivo sempre visível no topo.
- Captain Toad: dioramas que cabem na tela.
- Astro's Playroom: alegria de cada contato com o chão.
- Tearaway: o mundo é papel.
- Super Mario 3D World: clareza de leitura de plataformas (a homenagem é de gênero, não de personagem).
- Folio-2019/2025 do Bruno: bevel com sombra de contato, física em tudo, som em cada interação.
- Ilustração de cordel e xilogravura: tinta preta chapada sobre papel, para letreiros e o mapa.

### 2.3 Personagem: Victor

- **Silhueta:** 1.20 m, 2.6 cabeças. Cabelo preto com topete para frente (a marca da silhueta), jaqueta vermelho-sinal aberta sobre camiseta papel com um ponto de tinta no peito, calça tinta, tênis papel com cadarço vermelho e mochila tinta pequena.
- **Cachecol-fita:** uma tira de papel vermelho que **é um pedaço da Linha**. Ela tremula, cresce um pouco a cada era concluída e brilha ao "grindar".
- **Evitar trade dress:** sem boné vermelho, macacão azul, bigode ou luvas brancas.
- **Traços de semelhança** (cabelo, óculos, barba, tom de pele): decisão do dono D3. Padrão: sem óculos, sem barba, pele `#c98d6a`.
- **Rosto:** olhos ovais grandes (decal na textura de paleta), sobrancelhas que animam (2 bones), boca em 3 formas por troca de UV (neutra, sorriso, "o").
- **Personalidade:** curioso, otimista, "engenheiro que mexe em tudo". No idle longo ele olha o celular e depois abre um notebook sentado.
- **Orçamento:** ≤ 6 mil triângulos, 1 material de paleta + 1 de olhos, 24 bones.
- **Clipes:** `idle`, `idleLong` (celular), `sitLaptop` (AFK 20 s), `walk`, `run`, `skid`, `jumpUp`, `flutter` (planada da fita no 2º toque), `fall`, `landSoft`, `landHard`, `stamp` (saca um carimbo de borracha e desce com ele à frente), `push`, `grind`, `wave`, `interact`, `celebrate` e `hurtBump` (bate a cabeça num bloco sólido).
- **Camada procedural** em runtime: inclinação na curva, squash and stretch, olhar para o interativo mais próximo, cachecol em cadeia de molas, pés que respeitam o chão (raycast curto).

### 2.4 Linguagem de câmera
- 3ª pessoa "diorama": **yaw autoral por trecho** (empties `refCamera<n>` exportados do Blender com yaw, pitch e distância), com blend suave entre trechos. A entrada é sempre relativa ao yaw atual. Arrastar orbita ±25° e volta com mola.
- O avatar ocupa **12–16% da altura da tela** em paisagem e **10–13%** em retrato. Enquadramento em retrato: pitch maior e o foco deslocado para cima (o avatar no terço inferior, o caminho à frente visível).
- Em momentos (marco, card, ponto final), a câmera faz um enquadramento de "foto": o objeto à esquerda e o card no lado direito ou embaixo, **sem blur**. O mundo fica levemente dessaturado (−20%) em vez de borrado.

### 2.5 Som
- **Camadas:** ambiência por era (cigarras e vento do cerrado; burburinho de campus; zumbido de fábrica; chuva leve digital; cidade ao entardecer) + música por era em stems (base + melodia), com crossfade pela Linha + efeitos com variação de pitch de ±8–15% e antiSpam (técnica do `Audio.js`).
- **Música:** Origens em baião/pé-de-serra (zabumba, triângulo, sanfona), UNICAMP em lo-fi acústico, Indústria em percussão de máquina, Dados em arpejos synth e Transformação em pop eletrônico quente. Fonte da trilha: decisão D4.
- **Grind na Linha:** loop tonal cujo pitch acompanha a velocidade, com um "pluck" afinado na escala da música da era a cada marco que passa. A Linha é uma pauta musical.
- **Proibido:** qualquer melodia ou contorno de efeito reconhecível de jogos. Nenhum arquivo de áudio do folio-2025.

### 2.6 UI e HUD
- **Mínima e com marca:**
  - Canto superior esquerdo: um chip com a era e o progresso ("Origens · 1/3").
  - Canto superior direito: três botões redondos de 44 px (Menu, Som, Sair para a versão acessível).
  - O botão sinal **Contato** é o único vermelho da vista e aparece no menu e no chip quando aberto.
- **Cards:** `<dialog>` nativo com o mesmo conteúdo do `<article>` do 2D, painel lateral no desktop e bottom sheet no celular. Fontes da marca (Schibsted Grotesk, JetBrains Mono para números/ano, Fraunces 900 itálico só para o ano grande do card).
- **Prompt de interação:** tecla e ícone desenhados a tinta sobre papel, renderizados no mundo (técnica do `InteractivePoints`), com espelho no `aria-live`.

### 2.7 Os primeiros 10 segundos (storyboard)

| t | Visual | Som | Estado |
|---|---|---|---|
| 0.0 s | Na página 2D, o visitante aperta **Jogar**. A tela de papel creme fica; uma linha vermelha começa a se desenhar da esquerda e é a barra de progresso real (bytes). | Clique de papel | Carregando motor + Origens |
| ~1.5–3 s (desktop) / ≤ 6 s (celular) | A linha chega ao fim, vira o ponto final, e o ponto "cai" como gota de tinta. O papel se abre em pop-up (dissolve radial do motor, `Reveal`) e revela Araguaína ao amanhecer. | Acorde de sanfona + cigarras | Câmera já na posição de jogo |
| +0.6 s | Victor está sentado no meio-fio, levanta e acena para a câmera (`wave`). O primeiro bloco de marco "1994" flutua a 4 m dele, pulsando. | Passarinho, vento | **Controle liberado em ≤ 0.8 s após o reveal** (o aceno é cancelável) |
| +1 s | Primeiro toque no direcional: poeira vermelha sobe, o capim se curva, pegadas ficam na laterita (técnica de `Tracks`). | Passos na terra | Primeiro deleite < 5 s |
| +3–5 s | O primeiro pulo é alto e redondo, e o cachecol-fita tremula. A cabeça bate no bloco 1994, que salta, solta um sinal vermelho que voa para o HUD, e uma casinha pop-up se ergue com um ipê florindo. | "Plim" afinado + papel se dobrando | |
| +5–8 s | Card "Setembro de 1994 · Nasci em Araguaína/TO" desliza (sem blur). Esc, B ou um toque fora fecha. | Música entra (stem base) | Primeiro marco < 15 s |
| +8–10 s | A Linha vermelha nasce na porta da casa e corre para o horizonte, onde o ponto final gigante brilha no topo do morro central. Uma placa de cordel diz "Contato →" junto de um cano com ponto vermelho. | Pluck da Linha | Objetivo e atalho visíveis |

### 2.8 Momentos "uau" (alvo: ≥ 1 por era + 3 de assinatura)

Assinatura:
- **A Linha que se desenha** no carregamento e vira o mundo.
- **O grind na Linha:** subir na fita e deslizar com música, passando pelos anos.
- **O ponto final:** pular no ponto gigante faz ele "carimbar" a tela e abrir o contato.

Por era:
1. **Origens:** o ipê explode em flores amarelas quando o marco abre. O **monitor CRT gigante** (o blog Ponto Interativo de 2005) liga ao levar um carimbo no botão e mostra uma página pixelada do blog. O capelo da formatura (2011) voa e cai na cabeça do Victor.
2. **UNICAMP:** a **floresta de nanotubos de titânio** são pilares hexagonais que sobem e descem como teclas de piano ao pisar. Os sites para ONGs são casinhas cujas janelas viram "páginas web" iluminadas.
3. **Indústria:** esteira de garrafas genéricas (sem logos) que o Victor pode chutar em dominó físico. O **voo para a Alemanha** é uma travessia de dirigível de papel até uma ilha enxaimel.
4. **Dados:** **gráfico de barras vivo**, barras que crescem conforme se aproxima e viram escada. Uma constelação de pontos de dados forma a regressão quando todos os sinais são coletados.
5. **Transformação digital:** a **praça de cartuchos**, onde cada projeto é um cartucho gigante que se encaixa num console-pedestal e projeta a demo. O casamento é um arco de luzinhas sob um ipê. O ponto final fecha a jornada.

---

## 3. Jogabilidade e controles

### 3.1 Locomoção: decisão

| Opção | Prós | Contras | "Divertido em 3 s"? |
|---|---|---|---|
| A. Veículo (reusar `PhysicsVehicle`/`Player`/`VisualVehicle` do folio) | Física pronta e provada. Mobile com um dedo já existe. | É **a assinatura do Bruno**, o que torna o reskin mais provável. Esconde o personagem que o dono criticou. Não combina com blocos batidos por baixo nem com canos. | Sim, mas é o mesmo "sim" do Bruno |
| B. **A pé, plataforma 3D + grind na Linha** | Original. Casa com a homenagem retrô que o dono ama e põe o Victor em primeiro plano. Reusa Physics, Objects, Inputs, View, Audio, Zones e InteractivePoints. | Controlador novo (Rapier `KinematicCharacterController`) e clipes de animação, que é o maior risco de qualidade. | Sim, se o pulo for perfeito e o primeiro bloco estiver a 4 m |
| C. Híbrido: B + 1 trecho de veículo (empilhadeira/carrinho na Indústria, reusando `PhysicsVehicle`) | Variedade, e usa o melhor código do Bruno num lugar só | Escopo | Idem B |

**Recomendação: B como base e C como opcional da Fase 3.** É a decisão D1 do dono, tomada no **Gate G1** depois de um spike gravado em vídeo: dois greyboxes (a pé e veículo) no mesmo percurso de 30 s.

Física: **Rapier `@dimforge/rapier3d` 0.21.0** (não-compat, wasm separado e streamado), como no motor.
- Corpo do Victor: cápsula raio 0.28 m, meia-altura 0.32 m (altura total 1.2 m), cinemática, movida por `KinematicCharacterController`:
  - `offset 0.02`, `maxSlopeClimbAngle 50°`, `minSlopeSlideAngle 55°`;
  - `autostep 0.35 m (minWidth 0.15, dynamic: true)`, `snapToGround 0.3 m`;
  - `applyImpulsesToDynamicBodies: true` (o personagem empurra caixotes, garrafas e cercas do sistema `Objects`).
- O platformer é uma camada nossa sobre o KCC: velocidade desejada → `computeColliderMovement` → `computedMovement` → `setNextKinematicTranslation`. Gravidade, pulo, coyote e buffer ficam no nosso código, não na gravidade do mundo.

### 3.2 Metas de sensação (valores iniciais; todos no painel `?debug`)

| Parâmetro | Valor | Justificativa |
|---|---|---|
| Velocidade de andar (stick < 50%) | 3.0 m/s | Mira fina perto de blocos |
| Velocidade de correr | 7.0 m/s | ~6 corpos/s, mundo de 60–80 m por era atravessável em ~10 s |
| Aceleração no chão | 0 → 7 m/s em **0.14 s** (curva ease-out: 50% em 0.05 s) | Resposta imediata com "peso" |
| Desaceleração no chão | 7 → 0 em **0.10 s** | Para onde o jogador quer |
| Controle no ar | aceleração 26 m/s², desaceleração 8 m/s² | Corrige o pulo sem "patinar no ar" |
| Giro do corpo | slerp de yaw a 900°/s, inclinação de até 12° proporcional à curvatura | Leitura de direção |
| Derrapagem | inverter > 135° acima de 4.5 m/s → `skid` 0.12 s + poeira + som | Sensação física |
| Pulo | apex **2.0 m** em **0.34 s** → `g_subida = 34.6 m/s²`, `v0 = 11.8 m/s` | 1.7× o corpo, legível |
| Queda | `g_queda = 1.7 × g_subida = 58.8 m/s²`, velocidade terminal 20 m/s | Arco redondo, aterrissagem decidida |
| Pulo variável | soltar → `vy = min(vy, 4.5)`, pulo mínimo ~0.55 m | Controle fino |
| Planada da fita (2º toque no ar) | o cachecol-fita abre como pipa: impulso de +0.6 m e gravidade ×0.35 por até 0.6 s, com `flutter` | Exploração e segredos, sem o giro clássico de pulo duplo |
| Coyote / buffer | 0.10 s / 0.12 s | Tolerância moderna |
| Carimbo (no ar) | Victor saca um carimbo de borracha gigante: trava 0.12 s → desce a 26 m/s com o carimbo à frente → marca o "ponto" no chão | Liga botões e quebra caixotes, com leitura de "carimbar" e não de "sentar" |
| Grind na Linha | entra encostando na fita no ar; velocidade 9–14 m/s (+ ladeira); pular sai com +20% de velocidade | Assinatura e atalho de travessia |
| Latência entrada → movimento (simulação) | O comando é aplicado no próximo passo fixo (≤ 8.3 ms) e aparece no frame seguinte | O ghost injeta no mapa de ações, então mede **só** a latência da simulação. A latência real (SO, navegador, compositor, tela) não é medida aqui, e o "feel" humano vem do playtest. |

### 3.3 Câmera (adaptação do `View.js`)

| Parâmetro | Regra / valor |
|---|---|
| FOV horizontal-alvo | **63°** (equivale a 38° de FOV vertical em 16:9) |
| FOV vertical | `vFov = clamp(2·atan(tan(63°/2) / aspect), 38°, 55°)`. Em 16:9 dá 38°. Em 390×844 (aspect 0.46) o valor bruto seria ~106°, então **trava em 55°**: nada de FOV vertical extremo. |
| Distância ao foco | `d = max(10.5 m, W_min / (2·tan(hFovEf/2)))`, com `hFovEf = 2·atan(tan(vFov/2)·aspect)` e `W_min = 6 m` de largura útil no plano do foco. Em 16:9: 10.5 m (avatar ≈ 16% da altura). Em 390×844: hFovEf ≈ 27°, d ≈ 12.5 m (avatar ≈ 9%). **Remedido na T1.7.** |
| Pitch | 28° em paisagem, 36° em retrato (interpolado pelo aspect entre 1.0 e 0.5) |
| Offset do foco | +0.9 m em y (paisagem) a +1.6 m (retrato, avatar no terço inferior) |
| Suavização XZ | Mola crítica, meia-vida 0.10 s |
| Suavização Y | Meia-vida 0.25 s. **Y travado no ar**: só segue ao pousar ou se cair > 1 m abaixo da última plataforma. |
| Look-ahead | 1.5 m × (v/vmax), meia-vida 0.35 s (1.0 m em retrato) |
| Órbita manual | ±25° de yaw e ±8° de pitch, volta em 1.2 s. Opcional (botões de 44 px, Q/E ou dois dedos). |
| Shake | Só no carimbo e na aterrissagem forte (≤ 0.08 m, 0.15 s). Desligado em movimento reduzido. |

### 3.4 Entradas

| Ação | Teclado | Gamepad | Toque (um polegar) |
|---|---|---|---|
| Mover | WASD / setas (relativo à câmera) | analógico esquerdo | **arrastar em qualquer lugar da metade esquerda (60%)**: joystick flutuante (`Nipple`), raio 64 px, zona morta 10 px, velocidade máxima a 48 px, haste curta desenhada a tinta. **Alternativa de ponteiro único (WCAG 2.5.7):** tocar no chão ou num marco = andar até lá. |
| Pular / planada (2º toque) | Espaço | A / Cruz | **tocar em qualquer lugar da metade direita** (sem botão minúsculo); botão visível de 76 px como dica nos primeiros 20 s |
| Carimbo | Shift / C (no ar) | B / Círculo | botão contextual "Carimbar" (64 px, aparece no ar). Deslizar para baixo é só atalho opcional. |
| Interagir | E / Enter | X / Quadrado | botão contextual de 64 px que só aparece perto de interativo |
| Câmera | arrastar com mouse ou Q/E | analógico direito | botões ⟲ ⟳ de 44 px (ponteiro único). Dois dedos é opcional, e a câmera automática dispensa a órbita. |
| Menu / sair | Esc | Start | botão do HUD |
| Mapa | M | Select | botão do menu |
| Ir até (acessibilidade e um dedo) | Tab cicla os marcos, Enter caminha até eles (auto-walk) | — | tocar num marco distante → caminho automático (navmesh simples sobre a Linha) |

- Vibração: `navigator.vibrate(12)` no carimbo e no marco, só no Android, com opção de desligar.
- Teclas só são capturadas com o canvas focado (regra mantida do build atual, `input.js`).

### 3.5 Afinação
- `?debug` carrega o Tweakpane de forma preguiçosa (o padrão do `Debug.js`), com uma pasta **Feel** contendo todos os valores de 3.2 e 3.3, um preset salvo em `localStorage` e um botão "copiar JSON".
- `?debug&ghost=<nome>` reproduz uma sequência de entradas gravada (formato `[{t, action, value}]`) para medir e gravar vídeo de forma determinística.
- O valor final vai para `sources/data/feel.js`, versionado.

---

## 4. Level design

### 4.1 Topologia: "anel com ponto central"

```
                 [4 Dados]
        [3 Indústria]      [5 Transformação + Praça de projetos]
              \                 /
   [3b Alemanha]   ( PONTO FINAL )   <- morro central, visível de todo lugar
   (ilha, dirigível)  \      /
                 [2 UNICAMP]
                        \
                     [1 Origens]  <- spawn (Araguaína ao amanhecer)
```

- As 5 eras ficam num **anel** ao redor de um morro central. No topo do morro está o **ponto final** (esfera vermelha de 6 m, emissiva): o marco de navegação, visível de todo o mundo.
- **A Linha** percorre o anel em ordem cronológica, passa por todos os 15 marcos, e no fim da era 5 sobe o morro em espiral até o ponto.
- Atalhos:
  - Cada era tem um **cano-atalho** (cobre com anel vermelho) que leva ao ponto final.
  - O HUD tem "Contato" e "Projetos".
  - O grind na Linha atravessa uma era em ~6 s.
- Cada era tem 60–80 m de diâmetro, é uma ilha-diorama com borda de papel cortado e se liga às vizinhas por pontes da própria Linha. O streaming é por era (seção 6.5).

### 4.2 Metas de ritmo (testadas por ghost run e playtest)

| Meta | Alvo | Como |
|---|---|---|
| Primeiro deleite | < 5 s após o reveal | Poeira, capim e pegadas no primeiro passo; bloco 1994 a 4 m |
| Primeiro marco | < 15 s | Bloco 1994 sem obstáculo |
| Contato pelo atalho | < 30 s desde o Start (desktop e celular com rede boa) | Cano do spawn a 6 m → warp 1.5 s → ponto final → card |
| Contato só com teclado | ≤ 4 teclas na página `play/` (Tab → "Contato" → Enter) | Botão do HUD |
| Era completa (3–4 marcos + metade dos sinais) | 60–120 s | Teste com 3 pessoas |
| Jornada completa | 8–12 min (exploração), 3 min (grind direto) | |

### 4.3 Origens (fatia vertical): planta e batidas

Área de 70 × 55 m. Amanhecer. Rio Tocantins ao sul (faixa de água com `WaterSurface`).

| # | Batida | Local | Mecânica | Recompensa |
|---|---|---|---|---|
| O1 | Spawn no meio-fio da rua de laterita, com casas baixas ao fundo | centro-sul | Primeiros passos (poeira, pegadas) | Deleite |
| O2 | **Marco 1994: "Nasci em Araguaína/TO"** | 4 m a nordeste do spawn | Bloco de papel batido por baixo | Casinha pop-up + ipê florindo + card |
| O3 | Placa de cordel "Contato →" + cano-atalho | 6 m a oeste do spawn | Entrar no cano (↓ / toque) | Warp ao ponto final (na fatia: mini-ilha provisória) |
| O4 | Subida de cupinzeiros (degraus naturais) com 3 sinais no ar | leste | Pulos em sequência (tutorial implícito do pulo variável) | Sinais |
| O5 | **Marco 2005: "Fiz o meu primeiro blog, Ponto Interativo"** | morrinho a nordeste | CRT gigante (3 m) sobre a mesa de madeira. Subir pela cadeira e pelo teclado (plataformas). Carimbar o botão de power. | Tela liga com a página pixelada "Ponto Interativo" (arte original) + card |
| O6 | Pomar de pequizeiros com caixotes de pequi | norte | Empurrar e quebrar caixotes (Rapier dinâmico) | Sinais e um segredo |
| O7 | **Segredo:** cupinzeiro oco com cano escondido | noroeste, atrás de buritis | Carimbo no topo abre | Quartinho dos anos 2000 com um console genérico e um sinal raro |
| O8 | **Marco 2011: "Terminei o ensino médio"** | escola a oeste | Pátio com mastro. Subir pelos telhados. | O capelo voa, cai na cabeça do Victor (acessório até o fim da era) + card |
| O9 | Seriema atravessa correndo (vida ambiente) | aleatório no norte | Persegue se o jogador corre atrás | Conquista "Corredor do cerrado" |
| O10 | Ponto de ônibus "Araguaína → Campinas" | saída norte | Na fatia, placa "Em breve". No jogo completo, o ônibus de papel leva à era 2 (transição de 4 s com pulo para cancelar). | Transição |
| O11 | A Linha | da porta da casa (O2) passando por O5 e O8 até O10 | Grind | Atalho e música |

Sinais (colecionáveis) na Origens: 20, com 3 escondidos. Os sinais só alimentam o HUD e uma conquista: **nada de conteúdo fica trancado atrás de habilidade**. Todo marco também abre por interação simples no modo de movimento reduzido ou de assistência.

### 4.4 Eras 2–5 (para a Fase 3)

| Era | Marcos (do DOM) | Set pieces | Segredo |
|---|---|---|---|
| 2 UNICAMP | 2012-01 entrei na UNICAMP · 2012-07 sites para ONGs · 2012-12 IC em nanotubos de titânio · 2014-07 Empresa Jr. MTE | Portão do campus. Floresta de nanotubos (pilares hexagonais que oscilam). Rua das ONGs (janelas que viram páginas). Sala da empresa júnior com mesa de reunião (plataformas). | Laboratório no subsolo |
| 3 Indústria | 2017-01 Coca-Cola FEMSA · 2018-07 estágio na KRONES/AG (Alemanha) · 2019-01 Trainee | Fábrica com esteiras móveis (plataformas cinemáticas), garrafas genéricas físicas, dirigível de papel até a **ilha Alemanha** (enxaimel). Opcional: empilhadeira dirigível (opção C). | Caixa-forte de engrenagens |
| 4 Dados | 2019-10 volta ao Tocantins / Damásio · 2021-06 Ciência de Dados na IBM | Gráfico de barras vivo (escada que cresce), dispersão de pontos que forma a regressão. Rio Tocantins volta (rima visual com a era 1). | Matriz de confusão (labirinto 2×2) |
| 5 Transformação digital | 2022-01 sites e apps profissionalmente · 2022-09 ALI do SEBRAE · 2022-09 casamento | Praça de cartuchos (6 projetos), arco do casamento sob ipê com luzinhas, balcão do SEBRAE (pequenos negócios = vitrines). Espiral final até o ponto. | Sala de bastidores com o mapa do pipeline Blender (créditos, inclusive o MIT do motor) |

Nomes de empresas aparecem **só como texto** nos cards, nunca como logo ou trade dress no mundo.

### 4.5 Projetos e contato como momentos
- **Projetos** (6 do DOM: dtcg-contrast, xbox-sales, snake-arena, Meu Poupig, js-games, Financial Sample Analysis):
  - Cada um é um **cartucho gigante** com rótulo desenhado a tinta: nome e ícone simples original por tema (ex.: paleta de contraste, gráfico, cobra de pixel, porquinho, joystick, pizza de gráfico).
  - Ao carimbar o pedestal, o cartucho encaixa, a tela grande projeta a imagem e o card abre com "Ver projeto" e "Código".
- **Contato:**
  - Pular no ponto final faz um carimbo de tela inteira (papel e tinta) e abre o card de contato (o mesmo `#contato` do 2D, com o único botão sinal "Falar com Victor").
  - Depois do card, a câmera recua e mostra **o anel inteiro com a Linha acesa**: o "créditos" da vida.

---

## 5. Pipeline de arte (Blender 5.3 scriptado, `bpy`)

### 5.1 Decisão de iluminação (D2): paleta + luz estilizada em tempo real + AO no vértice

O pedido original falava em "luz bakeada em texturas". O motor reusado prova outra coisa (seção 0.2): o visual do folio-2025 é **paleta + Lambert estilizado em TSL** e roda no celular no `Quality.level 1` com sombra de 512².

**Recomendação:** manter esse modelo e somar o que barateia e embeleza no celular.

| Camada | Desktop (Q0) | Celular (Q1) | Custo |
|---|---|---|---|
| Cor | textura de paleta 16×16 (PNG, nearest, ~1 KB) | idem | 1 fetch |
| Sombra de núcleo, cor de sombra, bounce e névoa | TSL do `MeshDefaultMaterial` | idem | ALU barata |
| **AO de contato** | bake Cycles de AO → atributo de vértice `COLOR_0` (multiplicado na cor) | idem | zero texturas extras |
| **Sombra estática** do diorama | shadow map 2048² (como o motor) | **sombra bakeada** de cima para baixo por era (PNG/WebP sem perda, R8 1024², projetada no XZ), sem shadow map | 1 fetch no chão |
| Sombra dos dinâmicos (Victor, caixotes) | shadow map | **blob** (decal instanciado) | ~1 draw call |
| Pós | bloom (Linha e ponto) + `cheapDOF` leve | nenhum, ou bloom de 2 mips (`Q1+`) | |

Assim o "visual-alvo" fica idêntico em essência nos dois tiers, e o celular não paga sombra em tempo real.
**Alternativa rejeitada:** lightmaps Cycles completos com UV2 por era. Brigam com o renderer reusado, travam a luz da era, pesam 2–4 MB por era e impedem a transição de luz entre eras.

### 5.2 Estrutura de pastas da arte (dentro de `game/`)

```
game/blender/
  lib/          vn_scene.py (unidades, coleções, limpeza), vn_palette.py (UV para swatch),
                vn_shapes.py (blob, caixa arredondada, tubo, fita), vn_bevel.py, vn_collide.py
                (cria filhos trimesh*/hull*/cuboid*/…), vn_refs.py (empties ref*),
                vn_bake_ao.py (AO → COLOR_0), vn_bake_shadow.py (sombra top-down),
                vn_rig.py, vn_anim.py, vn_export.py (glTF com custom props)
  palette/      palette.json (nome → índice → hex), make_palette.py → static/palette.png
  kits/         platform_kit.py, cerrado_kit.py, campus_kit.py, factory_kit.py, data_kit.py,
                plaza_kit.py, line_kit.py (a Linha como curva + malha de fita)
  character/    victor_model.py, victor_rig.py, victor_anims.py
  eras/         origens.py, unicamp.py, industria.py, alemanha.py, dados.py,
                transformacao.py, hub.py (cada um monta a era a partir dos kits + layout)
  build_all.py  roda tudo em ordem; `blender -b -P build_all.py -- --only origens`
  out/          .blend gerados (gitignored)
game/static/    só saídas exportadas e comprimidas (servidas)
```

### 5.3 Convenções (as do motor, para reusar `Objects`, `References` e `Area`)

- **Visual vs físico:** cada era exporta `eras/<era>/<era>Visual.glb` (malhas visuais mescladas por material) e `eras/<era>/<era>Physical.glb` (só colisores). Os objetos dinâmicos vão em `eras/<era>/<era>Objects.glb`, com um nó por objeto: filhos visuais + colisores `cuboid*`/`hull*`/`ball*`/`cylinder*` + custom props `mass`, `friction`, `restitution`, `category`.
- **Referências:** empties `ref<Nome><n>`, por exemplo:
  - `refMilestone1994`, `refRespawnOrigens`, `refCamera3`, `refLinePoint12`;
  - `refZoneBounding` (escala x = raio), `refZoneFrustum`, `refSignal7`;
  - `refPipeContact`, `refSecretTermite`.
- **Instâncias** (árvores, capim, cupinzeiros): `…References.glb` com empties posicionados + `…Visual.glb` com 1 malha base (padrão `Trees.js`/`Foliage.js`/`Bushes.js`) → `InstancedGroup`.
- **Nomes de arquivo:** `camelCase`, sufixo `-compressed.glb` gerado pelo pipeline (convenção do motor), texturas PNG/WebP sem perda (máscaras RGBA de terreno nunca com perda). Os nomes servidos ganham hash de conteúdo no build (T0.15).
- **Unidades:** 1 unidade = 1 m. +Y para cima no glTF. Pivô no chão.

### 5.4 Modelagem por família (o que o script faz)

| Família | Técnica `bpy` | Tris por peça | Notas |
|---|---|---|---|
| Kit plataforma (bloco de marco, tijolo, cano, sinal, placa de cordel) | Primitivas + `Bevel` (largura 0.06, 3 seg.) + `WeightedNormal` + relevo do ponto via `Boolean` | 200–900 | O bloco de marco tem face papel com ponto vermelho em relevo. O cano tem borda com lábio. |
| Vegetação do cerrado (buriti, ipê, pequizeiro, capim, flores) | Tronco por curva + `Skin`/`Screw`. Copa por blobs (metaballs → malha → `Decimate`). Folhas de buriti em leque por array de fitas. | 300–1500 | Capim vira instância do `Foliage` do motor (SDF) com nossa textura. |
| Rochas e cupinzeiros | Icosfera + `Displace` (ruído) + `Remesh` voxel + `Decimate` + bevel | 150–400 | Forma de "massa de modelar" |
| Arquitetura (casas, escola, campus, fábrica, enxaimel) | Caixas com bevel, janelas por `Boolean` em array, telhas por array | 1–6 mil | Paredes papel, detalhes tinta |
| Landmarks (CRT, cartuchos, barras, ponto final) | Feitos sob medida por script | 2–8 mil | Cada um tem um script próprio e um render de checagem |
| Terreno da era | Grid 128×128 + `Displace` por imagem de altura gerada (numpy) + bordas de papel recortado (extrusão de contorno) | 20–30 mil | Mais textura de dados RGBA (canal R = caminho de laterita, G = grama, B = água, A = sombra bakeada) para os shaders do `Terrain`/`Grass` |
| A Linha | Curva Bézier por `refLinePoint*` → malha de fita (perfil 0.35 × 0.04, 1 seg/0.25 m) + export dos pontos como spline JSON | ~4 mil por era | O mesmo JSON alimenta o grind |
| Victor | Malha por partes (cabeça, cabelo, tronco, membros) unidas, bevel, `Remesh` só no cabelo | ≤ 6 mil | Ver 5.6 |

**Validação de cada script:** renderiza com Eevee 3 vistas fixas (frente, 3/4, cima) de 512² em `game/blender/out/previews/<asset>.png` e imprime tris/materiais. Essas imagens servem para checar a modelagem, **não para nota de "feel"**.

### 5.5 UV, paleta e AO
- `vn_palette.assign(obj, face_selector → "paper"|"signal"|…)` move as UVs da face para o centro do swatch (0.5/16 + i/16). Um único material `palette` por arquivo, com o nó de textura **mutado** no export (a convenção do motor: a textura é aplicada no `Material` do three).
- **AO no vértice:** Cycles `bake_type='AO'`, `target='VERTEX_COLORS'`, 64 amostras, distância 0.6 m, aplicado **depois** do merge por era, para pegar o contato entre peças. Antes, o script subdivide localmente as faces grandes (≥ 1 m²) para ter vértices suficientes.
- **Sombra top-down (Q1):** câmera ortográfica de cima, Cycles com a luz da era → `ShadowCatcher` em plano → imagem R 1024² → canal A do terreno ou textura própria.

### 5.6 Rig e animação do Victor
- **Rig:** `vn_rig.py` cria uma armature de 24 bones (hips, spine×2, neck, head, brow L/R, shoulder/arm/forearm/hand ×2, thigh/shin/foot/toe ×2, scarf×3). Parent with automatic weights e correção de pesos por grupos nomeados (cabeça e cabelo 100% em `head`).
- **Clipes (`vn_anim.py`):** poses-chave definidas como dicionários de rotação por bone (graus), interpoladas em Bézier com easing por chave:
  - Run cycle: 8 chaves a 24 fps (0.5 s por ciclo a 7 m/s → passada 1.75 m).
  - Walk: 8 chaves, 0.7 s.
  - `jumpUp`, `fall` e `land`: 3–5 chaves.
  - Exporta as **NLA tracks** como animações glTF nomeadas.
- **Runtime (`CharacterVisual.js`):** `AnimationMixer` com máquina de estados e crossfades de 0.08–0.15 s. `timeScale` do run proporcional à velocidade (evita pé deslizando). Camadas procedurais: lean, squash, look-at, cachecol em molas, olhos e boca por troca de UV.
- **Plano B (D3b):** se o gate GB reprovar, mais rodadas de iteração (T2.IT1/IT2) e mais peso na camada procedural. Clipes de terceiros (ex.: Mixamo) **só entram se o dono pedir explicitamente**, com a fonte no log de licenças.

### 5.7 Compressão e orçamento de assets
- `game/scripts/compress.mjs`, adaptado do `scripts/compress.js` do motor:
  - GLB: `gltf-transform` `meshopt` (decoder de 7.7 KB gz em vez de Draco), quantização padrão.
  - Texturas: **PNG/WebP sem perda** na fatia. A paleta 16×16 tem ~1 KB, e as máscaras RGBA de dados do terreno e a sombra top-down têm ≤ 250 KB por era. **Sem KTX2/basis** (economiza 260 KB e um wasm no caminho crítico). A KTX2 (UASTC via `toktx`) só volta se a medição de memória de GPU no celular pedir, e só para texturas grandes de cor, nunca para máscaras de dados.
  - UI: WebP/SVG.
  - Saída: `hash-assets.mjs` (T0.15) renomeia com hash e gera o manifesto.
- **Orçamento por era** (transferido):

| Peça | Alvo |
|---|---|
| Visual + Physical + Objects + References | ≤ 600 KB |
| Máscaras e sombra da era (sem perda) | ≤ 250 KB |
| **Crítico por era** | **≤ 850 KB** |
| Áudio da era (ambiente + stem), carregado depois do reveal | ≤ 350 KB |
| **Total por era** | **≤ 1.2 MB** |

- **Comum:**
  - no caminho crítico: Victor núcleo (malha + 7 clipes de locomoção, ≤ 200 KB), paleta (~1 KB), kit plataforma (≤ 150 KB);
  - depois do reveal: clipes extras (≤ 120 KB) e sfx base (≤ 400 KB);
  - fontes: já existentes.
- **Draw calls:** visual estático mesclado por era em ≤ 6 malhas (opaco, folhagem, água, Linha, emissivos, bordas). Instâncias por tipo. Alvo ≤ 120 draw calls no celular e ≤ 250 no desktop.

### 5.8 Divisão procedural vs autoral

| Autoral (Blender) | Procedural (runtime, técnicas do motor) |
|---|---|
| Terreno, arquitetura, landmarks, Victor, kits, a Linha, colisores | Capim (`Grass`), folhas (`Leaves`), vento (`Wind`/`WindLines`), água (`WaterSurface`), pegadas (`Tracks`), confete (`Confetti`), reveal pop-up (`Reveal`), névoa (`Fog`), poeira e partículas |

---

## 6. Arquitetura técnica

### 6.1 Estratégia de repositório e deploy (D5)

| Opção | Prós | Contras |
|---|---|---|
| A. Build commitado em `T:next\` no `main` | Simples | Cada iteração soma binários ao histórico. O cache do Pages pode misturar versões. |
| B. Pages via Actions (artefato) no repo `timeline` | Sem build no git | Troca a fonte do Pages do live, e o 2D passa a depender de CI. Os assets-fonte continuam precisando estar no repo. |
| **C. Repo de preview separado (`voaneves/timeline-preview`)**, Pages a partir de um branch com **um único commit órfão** substituído por `push --force` a cada publicação | Zero histórico de binários. Não toca no live nem na configuração do Pages do `timeline`. O SW de `/timeline/` não alcança `/timeline-preview/`. | Um repo a mais (público, `noindex`) |

**Recomendação: C para os previews.** A produção vai para `play/` no `main` do `timeline` só no G4.
- `G:scripts\publish-preview.mjs`: `vite build` → `hash-assets` → pasta temporária → `git init` → commit único `preview <buildId>` → `git push --force` para o `main` de `PV:`. A sessão principal executa o push, com autorização.
- URL: `https://voaneves.github.io/timeline-preview/`.
- **Indexação:**
  - o preview leva `<meta name="robots" content="noindex">`;
  - `game/sources/index.html` também leva `noindex` no próprio fonte, porque a pasta `game/` do `timeline` é servida crua pelo Pages; o build de `play/` remove a meta por variável;
  - `robots.txt` em subcaminho não vale.
- **Binários no `main`:**
  - os assets gerados (`G:static\**`) ficam fora do git (`.gitignore`) entre gates e só são commitados nos marcos G1, G2, G3 e G4;
  - os `.blend` de override manual (`G:blender\manual\`) são fonte humana e são commitados;
  - entre gates, as cópias são o repo de preview e a pasta local.
- **Cache do Pages (~10 min):**
  - todo asset servido tem **hash de conteúdo no nome** (T0.15);
  - o HTML aponta para o JS com hash do Vite, o JS embute o `buildId`, o loader busca `asset-manifest.<buildId>.json`, e o manifesto aponta para `<nome>.<hash8>.<ext>`;
  - assim, JS novo nunca carrega GLB velho, nem o contrário.
- `vite.config.js`: `root: 'sources/'`, `publicDir: false` (os assets saem do `hash-assets`), `base: './'`.

**Integração com a página 2D:**
- O 3D é um **documento separado**, então o Lighthouse do `index.html` não é afetado.
- O Start navega para o alvo de uma flag de uma linha, `START_TARGET`, em `src/boot.js`: `'./play/'` no lançamento, `'legacy'` para o rollback (T5.2b).
- `<link rel="prefetch">` do HTML e do JS do `play/` é disparado por **intenção** (pointerenter ou focus no botão), nunca no load.
- O `play/` tem link fixo "Versão acessível" para `../#carreira`.

**Service worker** (`worker.js`, escopo `/timeline/`):
- bypass total para `/play/` e `/next/` e para `glb|png|webp|wasm|mp3|json` do jogo: o navegador usa o HTTP cache normal;
- `VERSION` sobe para `v8`.

### 6.2 Conteúdo: fonte única
- `game/scripts/extract-content.mjs` faz o parse do `../index.html` (dep. `linkedom`, pin exato) e gera `game/static/content.json`: `{eras:[{n,name,years,entries:[{id,datetime,label,title,body}]}], projects:[{id,title,summary,stack,live,repo}], contact:{text,links}}`.
- O build roda isso antes do Vite.
- **Teste de paridade:** 15 entradas, 6 projetos e 1 contato, com os mesmos ids do DOM. Se diferir, o build falha.
- Os cards no `play/` renderizam a partir do JSON com a mesma estrutura semântica (`<article>`, `<time datetime>`, `<h2>`).

### 6.3 Mapa de reuso do motor folio-2025, arquivo por arquivo

Legenda: **K** = manter (ajuste mínimo + cabeçalho MIT), **A** = adaptar, **R** = reescrever usando o arquivo como referência, **D** = descartar (não copiar).
O inventário de dependências real é confirmado na T0.3: o que for marcado K/A e importar algo marcado D vira A.

| Arquivo (`sources/Game/…`) | Ação | O que muda |
|---|---|---|
| `Game.js` | A | Listas de recursos novas, carga em 2 lotes (comum + era atual) + `ZoneStreamer`. Sem Server, Whispers, Tornado, Weather, BlackFriday ou Konami. |
| `Events.js`, `Ticker.js`, `Time.js`, `Viewport.js`, `utilities/*`, `Noises.js` | K | — |
| `Debug.js`, `Monitoring.js` | K | Tweakpane e stats-gl só com `?debug`, por `import()` dinâmico |
| `ResourcesLoader.js` | A | `MeshoptDecoder` no GLTFLoader, **resolução pelo manifesto com hash** (T0.15), progresso por bytes, cancelamento. Sem KTX2/basis na fatia (6.5). Se voltar, o `basis/` vem de `three/examples/jsm/libs/basis`, nunca do upstream. |
| `Rendering.js` | A | `?webgl` força `forceWebGL`. Pipeline por tier (Q0: DOF + bloom; Q1: bloom de 2 mips ou nenhum; Q2: nada). Escala de resolução dinâmica. |
| `Quality.js` | A | Tiers 0/1/2 por **medição** (não só UA): 3 s de amostra após o reveal → desce de tier se p90 > 18 ms; opção manual no menu |
| `PreRenderer.js` | K | Compila shaders durante o loader (evita travadas no primeiro marco) |
| `Materials.js`, `Materials/MeshDefaultMaterial.js` | A | Paleta nossa. AO por `COLOR_0`. Sombra bakeada no Q1 (amostra a textura top-down por `positionWorld.xz`). Gradientes e emissivos com a nossa paleta. |
| `Materials/MeshGridMaterial.js`, `World/Grid.js` | K (só debug) | — |
| `Ligthing.js` | A | Presets por era. Shadow map só nos dinâmicos e só no Q0. |
| `Cycles/Cycles.js`, `DayCycles.js` | A → `EraCycles` | Mantém a interpolação de presets, trocando o tempo pelo **progresso na Linha / zona atual** |
| `Cycles/YearCycles.js`, `Weather.js`, `Tornado.js`, `World/VisualTornado.js`, `World/RainLines.js`, `World/Snow.js`, `World/Lightnings.js` | D | Fora do escopo. A chuva leve da era Dados pode voltar na Fase 4, escrita do zero. |
| `Fog.js`, `Wind.js`, `Water.js`, `World/WaterSurface.js` | K/A | Cores da era, Rio Tocantins |
| `Terrain.js`, `World/Floor.js`, `World/Grass.js`, `World/Foliage.js`, `World/Leaves.js`, `World/WindLines.js`, `World/Flowers.js`, `World/Bushes.js`, `World/Trees.js` | A | Mesma técnica com nossos dados, malhas e texturas (SDF de folhagem nossa). Árvores do cerrado. |
| `Tracks.js`, `Trails.js` | A | Trilha do pneu vira **pegadas** e marcas de grind |
| `Physics/Physics.js`, `Physics/PhysicsWireframe.js`, `Objects.js`, `InstancedGroup.js`, `References.js`, `Zones.js` | K | Upgrade para Rapier 0.21 |
| `Physics/PhysicsVehicle.js`, `World/VisualVehicle.js` | K em quarentena | Só se D1 = C. Senão, D. |
| `Player.js` | R | Novo `Player` com estados `onFoot`, `grind`, `locked` e `cutscene`, delegando a `Character/CharacterController.js` |
| **novos** `Character/CharacterController.js`, `Character/CharacterVisual.js`, `Character/Grind.js`, `Character/Stamp.js` | novo | Seção 3 |
| `View.js` | A | Foco no personagem, yaw autoral por `refCamera*`, retrato, enquadramento de card sem blur. `camera-controls` só no modo livre `?debug`. |
| `Inputs/*` (Keyboard, Gamepad, Pointer, Wheel, Nipple, InteractiveButtons) | A | Mapa de ações novo. Nipple na metade esquerda, toque na direita = pulo, gesto de carimbo. Captura só com foco. |
| `InteractivePoints.js`, `RayCursor.js` | A | Arte e tipografia nossas. Espelho em `aria-live`. |
| `Respawns.js` | K | Respawns vindos de `refRespawn*` |
| `Reveal.js`, `World/Intro.js` | R | Loader da Linha + reveal pop-up (seção 2.7) |
| `Explosions.js`, `World/Confetti.js` | A | Explosão vira "estouro de papel". Confete na paleta nossa. |
| `Audio.js` | A | Engine mantida. **Registro de sons 100% novo.** Playlist trocada por stems por era com crossfade. |
| `Notifications.js`, `Modals.js`, `Menu.js`, `Overlay.js`, `Options.js`, `Tabs.js`, `Title.js`, `ClosingManager.js` | R | UI acessível (dialog nativo, foco, live region), com estilos dos tokens da marca |
| `Achievements.js`, `Map.js` | A (Fase 4) | Conquistas e mapa nossos, só locais (sem servidor) |
| `Server.js`, `World/Whispers.js`, `BlackFriday/*`, `Easter.js`, `KonamiCode.js`, `InputFlag.js`, `World/Fireballs.js`, `World/Lanterns.js`, `World/PoleLights.js`, `World/Scenery.js`, `World/Bubble.js`, `World/Benches.js`, `World/Bricks.js`, `World/Fences.js`, `World/ExplosiveCrates.js` | D, ou reescrever genericamente | Benches, Bricks, Fences e ExplosiveCrates viram um único `World/Breakables.js` genérico nosso (mesmo padrão `Objects` + `InstancedGroup`) |
| `World/Areas/Area.js`, `World/Areas/Areas.js` | K/A | Base e registro mantidos. A lista vira as eras. |
| `World/Areas/*Area.js` (Landing, Projects, Career, Lab, Circuit, Bowling, Cookie, Toilet, Social, Altar, Achievements, BehindTheScene, TimeMachine, Easter) | D | **Conteúdo do Bruno: não copiar.** Novas `World/Eras/OrigensEra.js` … `HubEra.js`. Comportamentos (ex.: carrossel de projetos) são reescritos. |
| `Geometries/LineGeometry.js` | K | Útil para a Linha no debug |
| `Geometries/PortalSlabsGeometry.js`, `Geometries/WindLineGeometry.js` | K se usado | — |
| `Passes/cheapDOF.js` | K (só Q0) | — |
| `TextCanvas.js` | K | Rótulos com Schibsted Grotesk e JetBrains Mono |
| `sources/data/*` | D | Vira `content.json` + `sources/data/feel.js`, `achievements.js` e `eras.js` nossos |
| `sources/index.html`, `sources/style/*.styl` | R | HTML acessível nosso + CSS puro com tokens (sem Stylus, sem Google Fonts, sem gtag) |
| `scripts/compress.js` | A | → `game/scripts/compress.mjs` (meshopt, presets nossos) |
| `static/**`, `resources/**` | **D, nunca copiar** | Inclusive `.blend`, sons, fontes, favicons e social. `basis/` e `draco/` vêm do pacote `three`. |

**Atribuição:**
- `LICENSES.md` ganha uma seção "folio-2025 (Bruno Simon), MIT" com o texto completo da licença.
- Cada arquivo derivado ganha o cabeçalho `// Adapted from brunosimon/folio-2025 (MIT, (c) 2025 Bruno Simon)`.
- O rodapé do menu e da sala de bastidores mostra "Motor baseado no folio-2025 de Bruno Simon (MIT)" com link.
- Créditos de three.js, Rapier e Howler.

### 6.4 Módulos novos e grafo de cena

```
Scene
 ├─ Sky (gradiente da era) + Fog
 ├─ Eras[] (Area)  ← streaming: cada era = {visual, physical, objects, references, instanced}
 │   └─ Milestones (blocos de marco, CRT, capelo…) · Signals (instanced) · Pipes · Line (fita)
 ├─ Hub (morro + ponto final)
 ├─ Player
 │   ├─ CharacterController (Rapier KCC)  ← Inputs
 │   └─ CharacterVisual (glTF skinned + AnimationMixer + procedural)
 ├─ Dynamic Objects (Rapier) · Breakables (InstancedGroup)
 ├─ FX: Grass, Foliage, Leaves, Tracks, Confetti, Explosions, WindLines, Water
 └─ View (câmera) → Rendering (RenderPipeline por tier)
DOM: HUD · Cards (<dialog>) · Announcer (aria-live) · Menu/Options · Loader da Linha
```

Prioridades no `Ticker`: as do motor + `5.5 CharacterController:post-physics`, `8 EraCycles`, `9 Milestones/Line`, `14 Announcer`.

### 6.5 Carga e streaming (orçamento recalculado)

**Caminho crítico** (o que precisa chegar antes do controle):

| Peça | gz | Lote |
|---|---|---|
| `play/index.html` + CSS inline | ≤ 15 KB | 0 |
| Fontes (Schibsted Grotesk e JetBrains Mono; provavelmente já em cache pelo 2D) | ≤ 60 KB | 0 |
| JS principal (three/webgpu + tsl + motor) | ≤ 420 KB | 1 |
| Rapier wasm (não-compat, compilação em streaming) | 1.17 MB | 1 |
| `content.json` + manifesto | ≤ 12 KB | 1 |
| Paleta PNG 16×16 | ~1 KB | 1 |
| Kit plataforma | ≤ 150 KB | 1 |
| Victor núcleo (malha + 7 clipes de locomoção) | ≤ 200 KB | 1 |
| Origens crítico (visual + física + objetos + refs ≤ 600 KB; máscaras e sombra sem perda ≤ 250 KB) | ≤ 850 KB | 2 |
| **Total crítico** | **≈ 2.88 MB** (teto 3.0 MB, falha > 3.2 MB) | |

**Fora do caminho crítico** (depois do reveal, em `requestIdleCallback`):
- todo o áudio (sfx base ≤ 400 KB + ambiente e stem de Origens ≤ 350 KB). O som só pode tocar depois do primeiro gesto dentro do `play/` de qualquer jeito, então nada se perde;
- os clipes extras do Victor (≤ 120 KB);
- a era vizinha e o hub.

**Sem KTX2/basis na fatia** (−260 KB e um wasm a menos).

**Tempos honestos** (estimativa; a T2.31 mede de verdade). As fases se sobrepõem (o wasm compila durante o download), então cada linha é teto, não soma exata.

| Perfil | Transferência | Rede (RTT, cascata) | Compilar wasm | Parse do JS | Shaders (`PreRenderer`) | **Até o controle** |
|---|---|---|---|---|---|---|
| Desktop, cabo 50 Mbps, RX 6750 XT | 0.5 s | 0.2 s | 0.15 s | 0.1 s | 0.4 s | **≈ 1.4 s** (meta ≤ 2.5 s) |
| Celular médio em "Fast 4G" (9 Mbps, 150 ms RTT), WebGL2 | 2.6 s | 0.6 s | 0.6 s | 0.4 s | 1.2 s | **≈ 5.4 s** (meta ≤ 6.5 s) |
| Celular, se o Pages não comprimir o `.wasm` (vira compat base64, 1.65 MB gz) | +0.4 s | | | | | **≈ 5.8 s** |

**Sequência:**
1. **Página 2D** (Lighthouse 100): nada de 3D. Prefetch só por intenção.
2. **Boot do `play/`:** o HTML pinta o papel e a Linha de progresso em CSS/SVG, e o JS principal vem com `modulepreload`.
3. **Lote 1** em paralelo.
4. **Lote 2** (era atual). O reveal acontece quando os lotes 1 e 2 terminam e os shaders foram pré-compilados (`PreRenderer`).
5. **Streaming:**
   - ao entrar numa era, a vizinha seguinte (e o hub) carrega em `requestIdleCallback`;
   - eras a 2+ de distância descarregam (`dispose` de geometrias, texturas e colisores, que saem do mundo Rapier);
   - a transição entre eras (ônibus, ponte da Linha) dura ≥ 3 s e esconde a carga, com fallback de "parada" e a Linha piscando se a era ainda não chegou.
6. **Content-Encoding no preview** (T0.11): se o `.wasm` não vier comprimido, trocar para `@dimforge/rapier3d-compat` e registrar a decisão.

### 6.6 Renderer e cor
- `WebGPURenderer`:
  - desktop: WebGPU quando houver, senão WebGL2;
  - **celular: `forceWebGL: true` (WebGL2) por padrão**, até o WebGPU passar na matriz da T1.11 no aparelho do dono (D17);
  - `?webgpu` e `?webgl` forçam um backend para teste.
- Saída sRGB e **tone mapping neutro ou nenhum**: a paleta é a verdade. O mapeamento é verificado com um swatch de calibração no T2.2, onde o render tem que bater com o hex com ΔE < 3.
- DPR:
  - desktop `min(dpr, 2)`;
  - celular `min(dpr, 2)` com escala de resolução dinâmica de 0.6–1.0, alvo de 60 fps.
- Pausa em `visibilitychange`. `webglcontextlost` / `device.lost` mostram um toast "O 3D parou" com o botão "Voltar para a versão simples".
- **Memória:**
  - GPU ≤ 180 MB no celular (PNG/WebP descompactadas: paleta ~1 KB, máscaras 1024² RGBA ≈ 5.6 MB com mips por era; a KTX2 só volta se a medição pedir), contada pelo `renderer.info` no painel debug;
  - heap JS ≤ 150 MB;
  - sem vazamento em 3 voltas de streaming (T3.x).

### 6.7 Código atual do timeline: reuso vs aposentadoria

| Arquivo | Destino |
|---|---|
| `index.html`, `assets/styles/main.css`, `tokens/*`, `dtcg-contrast.config.json` | **Mantidos.** Na Fase 5: botão Start → `./play/`, título e cópia ajustados, tela de título revisada. |
| `src/boot.js` → `assets/js/boot.min.js` | Mantido. Na Fase 5 perde o `import()` do mundo e ganha a navegação para `play/` + prefetch por intenção + fallback (sem WebGL2 → fica no 2D). |
| `src/world/*.js` (18 arquivos), `assets/js/world/*` | **Ficam vivos até a aprovação** (o live não muda). Na Fase 5 são **movidos** para `D:\GitHub\pode_apagar\timeline\src\world\` e `…\assets\js\world\` e depois `git rm` (regra do dono: nunca apagar). Ideias portadas: `content.js` → `extract-content.mjs`, padrões de dialog e foco do `ui.js` → `Cards.js`. |
| `scripts/build.mjs` | Na Fase 5 perde o build do mundo |
| `scripts/check-size.mjs` | Na Fase 5 perde a linha do `world.min.js`. O gate do 3D passa para `game/scripts/check-size.mjs` (seção 7.4). |
| `worker.js` | Bypass de `play/`, `next/` e binários do jogo (T0.10) |
| `assets/img/title-world*.avif/webp` | Substituídos por um pôster novo do mundo novo (Fase 5) e os antigos movidos para `pode_apagar` |

### 6.8 Dependências (`game/package.json`, pins exatos, ≥ 7 dias, `npm audit signatures`)

| Pacote | Versão alvo | Motivo |
|---|---|---|
| `three` | 0.187.0 | Igual ao motor e ao 2D |
| `@dimforge/rapier3d` | 0.21.0 (o motor usa 0.19.3) | Upgrade com smoke test (T0.7). Se quebrar, fixar 0.19.x e registrar a exceção. |
| `vite`, `vite-plugin-wasm` | as últimas com ≥ 7 dias na data da T0.5 | Build |
| `howler` | 2.2.4 | Engine de áudio do motor |
| `gsap` | a última com ≥ 7 dias | **Licença própria, não MIT** ("no charge", uso comercial permitido). Decisão D6: manter e registrar em `LICENSES.md`, ou trocar pelos tweens próprios (`springs.js`). |
| `tweakpane`, `@tweakpane/plugin-essentials`, `stats-gl` | últimas | Só no `?debug` (chunk separado) |
| `camera-controls` | última | Só no modo livre de debug |
| `seedrandom` | última | Se mantido |
| dev: `@gltf-transform/cli` 4.5.1, `linkedom`, `playwright` | — | Pipeline e testes |
| **Fora:** stylus, msgpack-lite, uuid, emoji-regex, vite-plugin-node-polyfills, @vitejs/plugin-basic-ssl, dotenv, sharp (se a UI for SVG/WebP já pronta), glob (trocar por `fs.glob` do Node 22+) | — | — |

### 6.9 Acessibilidade no `play/` (paridade, não enfeite)
- `<main>` com `<h1>` visualmente oculto, landmark de aplicação no canvas com `aria-label` e `aria-describedby` para a ajuda de controles.
- Botão "Lista de marcos" abre um painel HTML com todos os 15 marcos, os 6 projetos e o contato. Cada item tem "Ir até" (auto-walk) e "Abrir".
- `aria-live="polite"`:
  - era atual ("Origens, 3 marcos");
  - proximidade ("Bloco 1994: pressione E"), com throttle de 1.5 s;
  - marco aberto.
- Movimento reduzido (`prefers-reduced-motion` + opção no menu): câmera em cortes, sem shake, sem DOF, partículas a 20%, grind opcional (o auto-walk substitui), reveal por fade.
- Teclado-only completo, foco visível com o token `focus`, alvos ≥ 44 px no toque e ≥ 24 px no desktop.
- Contraste: novos pares do HUD, dos cards, do loader e dos rótulos do mundo em `tokens/timeline.tokens.json` + `dtcg-contrast.config.json`, rodando `npm run contrast`.
- Opções: som (mudo por padrão até o primeiro gesto; o botão é claro), volume da música, vibração, qualidade e "assistência" (pulo infinito e marcos por interação simples).
- **Ponteiro único (WCAG 2.5.7 e 2.5.1):** tudo o que usa arrasto, deslize ou dois dedos tem alternativa de toque simples: tocar para andar (T2.NAV), botão "Carimbar", botões de câmera e a lista de marcos com "Ir até".
- **Flashes (2.3.1):** nada pisca mais de 3× por segundo em área grande. O carimbo de tela inteira é uma transição única. Um script checa o vídeo (T2.27b).
- **Pausar (2.2.2):** botão e tecla (P ou Esc) congelam simulação, partículas, ambiente e música. No modo reduzido, as animações ambientes param.
- **Rota acessível:** o auto-walk (T2.NAV) segue o grafo `refNav*` e a Linha e anuncia cada parada. É o caminho de quem usa leitor de tela e de quem joga com um dedo.

---

## 7. Gates de qualidade e avaliação

### 7.1 Princípio
**Quadro estático nunca dá nota de sensação.** A nota vem de três fontes, nesta ordem de autoridade:

1. **Playtest do dono** (desktop + o celular dele) via URL de preview.
2. **Vídeo gravado na GPU real** a 60 fps, com ghost runs determinísticas e com jogo humano livre.
3. **Métricas** (fps, frame time, latência, bytes, tempos de ritmo).

Agentes revisores avaliam **contact sheets extraídas do vídeo** (ffmpeg, 4 quadros/s, grade 4×4) junto com as métricas e o relatório de ritmo. Eles não decidem "feel" sozinhos: no máximo apontam problemas.

### 7.2 Ferramentas de captura (Fase 0)
- `game/tools/capture/record.mjs` (Playwright, Chrome **headed**):
  - flags `--use-angle=d3d11 --ignore-gpu-blocklist --enable-gpu-rasterization --force-device-scale-factor=1`;
  - abre o build local (`vite preview`) com `?debug&ghost=<nome>&hud=0`;
  - posiciona a janela em 2560×1440 (desktop) ou na viewport emulada (celular).
- **Gravação:** `ffmpeg -f lavfi -i ddagrab=output_idx=0:framerate=60:video_size=2560x1440:offset_x=0:offset_y=0 -c:v h264_amf -quality quality -rc cqp -qp_i 18 -qp_p 20 out.mp4`. É Desktop Duplication, sem custo de GPU relevante, com o encoder AMF da RX 6750 XT. Fallback: `gdigrab` + `libx264 -preset ultrafast`.
- **Métricas:** a página expõe `window.__perf` com:
  - fps médio, p50/p95/p99 de frame time, tempo de GPU (WebGPU: timestamp query; WebGL2: `EXT_disjoint_timer_query_webgl2` se o navegador expuser; senão registrado como 'indisponível', nunca estimado);
  - draw calls, triângulos, texturas, `performance.memory`;
  - bytes transferidos (Resource Timing), tempo até o reveal e tempo até a primeira entrada aceita;
  - marcas de ritmo (primeiro marco, contato).
  O script grava `metrics.json` ao lado do mp4.
- **Ghosts** (gravados e reproduzidos pela T0.16, injetados no passo fixo): `game/tools/capture/ghosts/*.json`:
  - `first10s` (spawn → bloco 1994);
  - `contact30` (spawn → cano → ponto → card);
  - `origensFull` (todos os marcos);
  - `jumpArc` (pulos parados, para medir apex e tempo);
  - `skid` (inversões);
  - `latency` (ação injetada → velocidade > 0, em passos fixos; **mede só a simulação**, ver 3.2);
  - `platform`, `stamp`, `grind`, `secret` e `nav` (tarefas das Fases 1 e 2).
- **Contact sheet:** `ffmpeg -i out.mp4 -vf "fps=4,scale=480:-1,tile=4x4" sheet_%02d.png`.
- **Benchmark do Bruno** (T0.4): mesmo script em `https://bruno-simon.com/`, sem ghost (30 s de jogo manual pelo dono, ou entrada simulada simples), medindo transferência, tempo até a primeira entrada, fps e draw calls (se `#stats`). Isso ancora a rubrica com números, não com impressão. O dono também dá nota ao site do Bruno no **mesmo formulário** (T0.17), e essa nota é a âncora do 10.

### 7.3 Rubrica nova (0–11 por dimensão)
**10** = nível do bruno-simon.com medido na T0.4 (números + nota do dono no mesmo formulário). **11** = o superou de forma demonstrável.
**11/10 global** = todas as dimensões ≥ 9, média ≥ 10, e **pelo menos 3 dimensões nomeadas em 11** com evidência.

| # | Dimensão | Âncora 10 (evidência tipo Bruno) | Âncora 11 (superar) |
|---|---|---|---|
| 1 | Primeiros 10 s | Controle em poucos segundos, primeiro contato físico divertido, loader com identidade | Controle ≤ 0.8 s após o reveal, primeiro deleite < 5 s, primeiro marco < 15 s (ghost `first10s`) |
| 2 | Controle e física | Veículo com suspensão, derrapagem e capotagem, empurra tudo | Platformer com curva medida (apex 2.0 m ± 0.05, latência de simulação ≤ 1 passo), carimbo, grind, empurrões. 3 testadores dizem "gostoso" sem ser perguntados. |
| 3 | Câmera | Segue sem enjoar, zoom e órbita | Yaw autoral por trecho, Y travado no ar, enquadramento de momentos e retrato próprio |
| 4 | Direção de arte e coesão | Uma linguagem: paleta, bevel, sombra de contato, névoa | Idem + identidade da marca VOANEVES + cerrado reconhecível por brasileiro sem legenda |
| 5 | Personagem | (O Bruno não tem personagem) carro com personalidade | Silhueta reconhecível do Victor, 18 clipes, expressões, cachecol-fita |
| 6 | Level design e descoberta | Áreas temáticas, segredos, circuito | Cada era com ≥ 1 set piece + ≥ 1 segredo com pista + a Linha como guia |
| 7 | Juice e som | Som em cada interação, variação, música | Idem + música por era em stems + a Linha como pauta musical |
| 8 | História e clareza | Conteúdo em modais por área | **O mundo é a biografia.** O recrutador acha o contato < 30 s e lembra de ≥ 3 eras depois de 2 min (teste com 3 pessoas). |
| 9 | Mobile | Joga com um dedo, nível de qualidade baixo | Retrato e paisagem com enquadramento próprio, um polegar, ≥ 55 fps médio no celular do dono, transferência até o controle ≤ 3.0 MB vs. a do Bruno medida |
| 10 | Carregamento e performance | Carrega tudo de uma vez | Streaming por era. Desktop: até o controle ≤ 2.5 s (cabo). Celular: ≤ 6.5 s em "Fast 4G" (conta na 6.5). GPU ≤ 6 ms a 1440p no Q0. |
| 11 | Acessibilidade | (Ausente no Bruno) | Paridade completa: teclado-only, leitor de tela (lista de marcos + live), movimento reduzido, axe 0 violações, alvos e contraste no gate |
| 12 | Originalidade e IP | — | Auditoria com 0 arquivos do upstream, nenhum asset de terceiros sem licença registrada, nada da Nintendo, assinatura da marca |

**Candidatas a 11:**
- 8 História;
- 11 Acessibilidade;
- 9 Mobile (retrato + carga);
- 5 Personagem (o Bruno não tem).

Para declarar 11, é obrigatório ter **pelo menos 3** dessas com evidência.

### 7.4 Metas de performance e tamanho (gate automático `game/scripts/check-size.mjs` + `perf-gate.mjs`)

| Métrica | Desktop (Q0, 2560×1440, RX 6750 XT) | Celular (Q1) |
|---|---|---|
| fps | 60 travado, p99 ≤ 16.7 ms, tempo de GPU ≤ 6 ms | ≥ 55 médio, p95 ≤ 20 ms, 5 min sem cair abaixo de 45 (térmico) |
| Draw calls | ≤ 250 | ≤ 120 |
| Triângulos visíveis | ≤ 800 mil | ≤ 250 mil |
| Memória | GPU ≤ 400 MB | GPU ≤ 180 MB, heap ≤ 150 MB |
| JS principal (gz) | ≤ 420 KB (falha > 460) | idem |
| Transferência até o controle | ≤ 3.0 MB (falha > 3.2 MB) | idem |
| Por era (streaming) | ≤ 850 KB crítico + ≤ 350 KB de áudio depois | idem |
| Página 2D | Lighthouse 100×4 (mobile), HTML ≤ 30 KB gz, boot ≤ 8 KB gz, nada do 3D no load | idem |

### 7.5 Gate mobile (dentro da fatia)
1. **Proxy na máquina** (alerta precoce, **não é gate**):
   - emulação 390×844 e 844×390, DPR 3 com teto 2, `?q=1&webgl`, CPU 4×;
   - mede main thread ≤ 8 ms/frame (trace CDP), draw calls ≤ 120, tris ≤ 250 mil, memória de texturas e geometria ≤ 180 MB (`renderer.info`), número de passes e pixels sombreados (resolução efetiva × passes).
   - O throttle da CDP **não** reduz a GPU, então nenhum número de GPU do desktop é critério para o celular. A antiga meta "GPU ≤ 2.5 ms na RX 6750 XT" saiu do plano.
2. **Celular real (o gate):**
   - backend WebGL2 (padrão D17);
   - Android: trace de 20 s via `chrome://inspect` + log de 5 min da HUD `?debug`;
   - **gravação como evidência:** `adb shell screenrecord --bit-rate 8000000 --time-limit 180 /sdcard/run.mp4` (USB) ou a gravação de tela do próprio aparelho do dono;
   - iPhone: Safari Web Inspector + gravação de tela do iOS;
   - tempo de GPU no celular: `EXT_disjoint_timer_query_webgl2` se exposta; senão, só fps e frame time (registrado assim).
3. **Critérios:**
   - ≥ 55 fps médio, p95 ≤ 20 ms e 5 min sem cair abaixo de 45;
   - carga ≤ 6.5 s, com a rede real do dono anotada;
   - checklist subjetiva do dono: um polegar, retrato legível, calor, bateria.

### 7.6 Checkpoints do dono (gates humanos)

Todos usam o formulário `T:docs\RUBRIC-FORM.md` (T0.17), o mesmo que o dono usou para o site do Bruno na T0.4.

| Gate | Quando | O que o dono faz | Passa se |
|---|---|---|---|
| G0 | Fim da Fase 0 | Vê o vídeo e dá notas ao site do Bruno; vê o motor vazio no preview | Ferramentas OK, sem objeção |
| **G1** | Fim da Fase 1 | Joga as duas variantes no preview, no desktop e no celular, com WebGPU e WebGL2 | Decide D1, D12 e D17. Controle ≥ 8 no formulário, mesmo em greybox. |
| GA | Antes da T2.5a | Escolhe 1 de 3 silhuetas e aprova o turnaround | Folha de referência aprovada |
| GB | Depois da T2.8d | Aprova modelo e animação pelo turntable | Aprovado (senão, mais iteração) |
| GC | Depois da T2.13d | Dá notas sobre os hero assets (rodada 1) | As notas viram T2.IT3/IT4 |
| **G2** | Fim da Fase 2 | Joga a fatia no desktop e no celular real | **Todas as dimensões aplicáveis à fatia ≥ 9 e média ≥ 10.** Música fora da nota se D4 não tiver sido decidida. Resposta "não lembra reskin" na T2.32. |
| G3 | Depois de UNICAMP + Indústria | Joga as duas eras novas | A mesma régua do G2 |
| G4 | Pré-lançamento | Joga tudo no preview | Aprova `START_TARGET = './play/'` |

---

## 8. Roadmap

### 8.0 Regras para todas as tarefas
- **Uma tarefa = um entregável = um critério de aceite**, uma sessão de agente de ≤ 30 min, com relatório curto no fim. Se passar de ~30 min ou a hipótese não se confirmar, **parar e reportar**. Fases da mesma tarefa continuam no mesmo agente via `SendMessage`.
- **Fechamento de toda fase (decisão do dono, 2026-11-20):** cada fase termina com **duas passadas separadas**, nesta ordem: (1) **Revisão** (R): correção, qualidade e critérios de aceite da fase; (2) **Adversarial** (R, papel de atacante): tentar **quebrar** o que foi entregue (build/gates, determinismo do ghost, perf e travadas, a11y, originalidade/assets do upstream, cache/hash e preview, segurança da cadeia de dependências, entradas extremas, mobile/WebGL2). Os achados viram tarefas de correção; a fase só fecha com **nenhum achado Alto aberto** nas duas passadas. Ids: `T<n>.R` (revisão) e `T<n>.ADV` (adversarial).
- **Evidência de gate vem só de ghost runs** (T0.16), gravadas pela T0.8. Validação com teto: 1 build, 1 ghost gravado (≤ 60 s), 1 execução de cada gate e repetição de testes ≤ 10.
- **Toda tarefa que toca arquivos da raiz** (`T:index.html`, `T:src\**`, `T:assets\**`, `T:worker.js`, `T:tokens\**`, `T:dtcg-contrast.config.json`, `T:scripts\**`) tem aceite extra fixo: `npm run check` verde, `npm run contrast` verde e **1 run de Lighthouse mobile = 100×4**.
- Executores preparam localmente. **Commit e push só pela sessão principal**, com autorização do dono: uma mensagem Conventional Commits por tarefa, sem atribuição de ferramenta e sem `Co-Authored-By`.
- **Binários** (`.glb`, `.png`, `.webp`, `.mp3`) só entram no `main` nos marcos de gate (G1, G2, G3, G4). Entre gates, os previews são publicados pelo canal da 6.1 (sem histórico).
- **Buffer de retrabalho:** +35% sobre a soma das tarefas em cada fase. As durações de calendário abaixo já incluem esse buffer e a espera pelos gates do dono.
- Papéis:
  - E = executor (esforço médio; **E+** = esforço alto);
  - A = auxiliar (só leitura);
  - R = revisor (só leitura);
  - dono = o Victor.
- ∥ marca o que roda em paralelo, sempre em arquivos diferentes.

Caminhos:
- `T:` = `D:\GitHub\_kit-clones\timeline\`;
- `G:` = `T:game\`;
- `U:` = clone de leitura durável `D:\GitHub\_vendor\folio-2025\` no commit `70764a9` (criado na T0.3, fora do repo servido);
- `PV:` = repo de preview (6.1).

### Fase 0: Ferramentas e base do motor (≈ 2–3 dias de calendário)

| ID | Entregável | Papel | Dur. | Deps | Arquivos | Passos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|---|
| T0.1 | Blender instalado e testado | E | 15 min | — | `G:blender\smoke.py` | `winget install BlenderFoundation.Blender`; script cubo + bevel → `smoke.glb` | Blender **≥ 5.0** responde a `-b --version` (a versão exata fica registrada em `G:NOTICE.md`) e gera um glb válido | 1 execução |
| T0.2 | ffmpeg instalado | E | 10 min | — | — | `winget install Gyan.FFmpeg`; gravação de 3 s com `ddagrab` + `h264_amf` | `ffprobe` mostra mp4 de 60 fps (fallback `libx264` registrado se não houver AMF) | 1 gravação |
| T0.3 | Clone durável + inventário do motor | E (5 min) + A (25 min) | 30 min | — | `U:` | E: `git clone … D:\GitHub\_vendor\folio-2025 && git -C … checkout 70764a9`. A: imports, importadores, `game.server`, `resources.*` e `static/` de cada arquivo de `U:sources\Game\**`. | Relatório que confirma ou corrige a tabela 6.3 com o fecho mínimo "motor vazio" | — (leitura) |
| T0.4 | Âncora: benchmark do bruno-simon.com + nota do dono no **mesmo formulário** | E + dono | 25 min | T0.8, T0.17 | `G:tools\capture\baseline\bruno\` (gitignored), `T:docs\BASELINE.md` | `record.mjs` nos perfis desktop e mobile (30 s cada, jogo manual); o dono preenche `RUBRIC-FORM.md` para o Bruno | `BASELINE.md` com transferência, tempo até a 1ª entrada, fps médio/p95, draw calls e **as notas do dono por dimensão** | 1 run por perfil |
| T0.5 | Scaffold do `game/` | E | 30 min | T0.3 | `G:package.json`, lock, `G:vite.config.js`, `G:sources\**` (só K/A da 6.3), `G:scripts\compress.mjs`, `T:LICENSES.md`, `G:NOTICE.md` | Copiar **só código**; cabeçalho MIT por arquivo; pins exatos ≥ 7 dias; **`npm ci --ignore-scripts`**; listar pacotes com binário nativo ou `postinstall` (rolldown/esbuild e afins) e revisar cada um; `npm audit signatures` | `npm run build` conclui com o mundo vazio e **nenhum** arquivo de `U:static`/`U:resources` existe em `G:` | 1 build |
| T0.6 | Motor vazio rodando | E | 30 min | T0.5 | `G:sources\Game\Game.js` e os removidos da 6.3 | Remover Server, Whispers, BlackFriday, Easter, Konami, gtag, Tornado, Weather, YearCycles e Areas; chão + cubo dinâmico | `vite preview` a ≥ 60 fps sem erro, em WebGPU e `?webgl` | 1 abertura por backend |
| T0.7 | Rapier 0.21 validado | E | 20 min | T0.6 | `G:package.json`, `G:sources\Game\Physics\*` | `createVehicleController` e `createCharacterController` por 10 s em `?debug=physics` | Os dois simulam sem erro (ou exceção de versão registrada em `NOTICE.md`) | 1 run |
| T0.8 | Ferramenta de gravação | E | 30 min | T0.2 | `G:tools\capture\record.mjs`, `sheet.mjs` | Playwright headed + flags da 7.2 + ffmpeg + `window.__perf` + perfis | `record.mjs --profile desktop --seconds 10` gera mp4 60 fps + `metrics.json` + 1 contact sheet | 1 run por perfil |
| T0.9 | Perf HUD + `?debug` preguiçoso | E | 25 min | T0.6 | `G:sources\Game\Debug.js`, `PerfProbe.js` | `window.__perf`; Tweakpane só em `import()` | O bundle sem `?debug` não contém "tweakpane" | 1 build + grep |
| T0.10 | Bypass do SW para `play/` e binários | E + R | 15 + 10 min | — | `T:worker.js`, `T:worker.min.js` | `/play/`, `/next/` e as extensões `glb`, `png`, `webp`, `wasm`, `mp3` e `json` do jogo fora do SW; `VERSION v8` | Requisições de `play/` não entram em `caches` **+ aceite fixo da raiz** (check, contrast, Lighthouse 100×4) | 1 teste Playwright + 1 Lighthouse |
| T0.11 | Canal de preview sem inchaço | E | 30 min | T0.6, T0.15 | `G:scripts\publish-preview.mjs`, `PV:` | Build → pasta temporária → commit órfão único → `git push --force` no repo de preview (6.1) | URL de preview abre o motor vazio, com `noindex`, e o `Content-Encoding` de `.js/.wasm/.glb/.png` fica registrado em `NOTICE.md` | 1 publicação + 1 curl por tipo |
| T0.12 | `content.json` + teste de paridade | E | 25 min | T0.5 | `G:scripts\extract-content.mjs`, `G:tests\content-parity.test.mjs` | `linkedom` lê `T:index.html` | `node --test` passa com 5 eras, 15 entradas, 6 projetos e contato, e falha se o DOM divergir | 1 `node --test` |
| T0.13 | Auditoria de originalidade (script + manifesto) | E | 25 min | T0.3, T0.5 | `G:scripts\audit-originality.mjs`, `G:scripts\upstream-hashes.json` | Manifesto de sha256 do upstream (só hashes); comparação; grep de strings; allowlist `three/examples/jsm/libs/**` | Sai 0 hoje e sai 1 com um arquivo do upstream plantado num teste | 2 runs |
| T0.14 | Gate de tamanho e perf | E | 20 min | T0.9 | `G:scripts\check-size.mjs`, `perf-gate.mjs`, `G:budgets.json` | Orçamentos da 6.5 e da 7.4 | `npm run gate` falha com um orçamento artificialmente baixo | 2 runs |
| T0.15 | Nomes com hash + manifesto de assets | E | 30 min | T0.5 | `G:scripts\hash-assets.mjs`, `G:sources\Game\ResourcesLoader.js` | Copia `static/**` para `assets/<nome>.<hash8>.<ext>`; gera `asset-manifest.<buildId>.json`; o loader só pede pelo manifesto; o `buildId` vem embutido no JS (que já tem hash do Vite) | Trocar um glb muda o nome dele e o manifesto, e o JS antigo continua resolvendo os assets antigos (teste com 2 builds lado a lado) | 1 teste |
| T0.16 | Ghost: gravador e reprodutor | E+ | 30 min | T0.6, T0.9 | `G:sources\Game\Ghost.js`, `G:tools\capture\ghosts\` | `?ghost=rec` grava `[{t, action, value}]` no **passo fixo** (1/120 s) a partir do mapa de ações de `Inputs`; `?ghost=<nome>` injeta no mesmo ponto (não em eventos DOM), com semente fixa de RNG | Reproduzir o mesmo ghost 3× dá posição final idêntica (±1 mm) | 3 runs |
| T0.17 | Formulário de rubrica | E | 15 min | — | `T:docs\RUBRIC-FORM.md` | Uma linha por dimensão da 7.3, escala 0–11, campo de comentário, aparelho e data | O formulário cobre as 12 dimensões e é usado na T0.4 e em todo gate | revisão de 1 leitura |
| T0.18 | Revisão da Fase 0 | R | 20 min | T0.5–T0.17 | — | Licenças, pins, binários nativos, SW, preview, auditoria | Nenhum achado "alto" aberto | — |

**Gate G0** (dono, assíncrono): vê o vídeo e as notas do benchmark do Bruno e o motor vazio no preview.

Paralelismo da Fase 0:
- (T0.1 ∥ T0.2 ∥ T0.3 ∥ T0.10 ∥ T0.17)
- → T0.5 → (T0.6 ∥ T0.12 ∥ T0.13 ∥ T0.15)
- → (T0.7 ∥ T0.8 ∥ T0.9)
- → (T0.11 ∥ T0.14 ∥ T0.16) → T0.4 → T0.18

**Total da Fase 0: 18 tarefas.**

### Fase 1: Spike de locomoção e gate G1 (≈ 3–4 dias de calendário)

| ID | Entregável | Papel | Dur. | Deps | Arquivos | Passos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|---|
| T1.1 | Greybox de teste | E | 30 min | T0.1, T0.6 | `G:blender\eras\greybox.py` → `G:static\eras\greybox\*` | Reta, rampa de 30°, degraus de 0.3 m, 3 blocos a 3.2 m, 2 canos, plataforma móvel, 4 caixotes, vão de 4 m, fita de 20 m, `refRespawn`/`refCamera1/2` | Carrega no motor com colisores visíveis no `PhysicsWireframe` | 1 run |
| T1.2 | Andar e correr | E+ | 30 min | **T1.1, T0.8, T0.16** | `G:sources\Game\Character\CharacterController.js`, `Player.js`, `G:sources\data\feel.js` | KCC Rapier + curvas da 3.2 | Ghost `skid`: 0→7 m/s em 0.14 ± 0.02 s e 7→0 em 0.10 ± 0.02 s | 1 ghost |
| T1.3 | Pulo e planada da fita | E+ | 30 min | T1.2 | `CharacterController.js` | Gravidade própria, coyote, buffer, variável, 2º toque = planada | Ghost `jumpArc`: apex 2.0 ± 0.05 m em 0.34 ± 0.02 s | 1 ghost |
| T1.4 | Carimbo | E | 25 min | T1.3 | `G:sources\Game\Character\Stamp.js` | Trava, descida, anel, quebra caixote | Ghost `stamp`: o caixote do greybox quebra em 10/10 | 1 ghost (10 repetições) |
| T1.5 | Carregar o personagem em plataforma cinemática | E+ | 30 min | T1.2 | `CharacterController.js`, `G:sources\Game\World\MovingPlatform.js` | Delta da plataforma aplicado antes do KCC; herdar a velocidade ao pular | Ghost `platform`: 10 s parado na plataforma móvel com deriva ≤ 2 cm, e o pulo herda a velocidade da plataforma (±5%) | 1 ghost |
| T1.6 | Câmera em paisagem | E | 30 min | T1.2, **T0.8** | `G:sources\Game\View.js` | Valores da 3.3 (paisagem), Y travado no ar, blend `refCamera1→2` | Vídeo do `jumpArc` com o horizonte estável (desvio vertical do foco ≤ 5 cm no ar) | 1 gravação |
| T1.7 | Câmera em retrato (matemática de FOV) | E | 25 min | T1.6 | `View.js` | Fórmula da 3.3: FOV horizontal mantido, vertical derivado e limitado, distância compensa | Em 390×844 o avatar ocupa 9–12% da altura e a largura útil no foco é ≥ 6 m (medido) | 1 gravação |
| T1.8 | Toque com um polegar + alternativas de ponteiro único | E | 30 min | T1.3 | `G:sources\Game\Inputs\Nipple.js`, `Pointer.js`, `TouchControls.js` | Joystick à esquerda, toque à direita = pulo, botão contextual "Carimbar", **tocar no chão ou num marco = andar até lá** (WCAG 2.5.7) | Teste Playwright com toques sintéticos completa o greybox **sem nenhum arrasto** | 1 teste |
| T1.9 | Teclado e gamepad | E | 20 min | T1.3 | `G:sources\Game\Inputs\Keyboard.js`, `Gamepad.js` | Mapa da 3.4, captura só com foco | Ghost por teclado completa o greybox, e com o foco fora do canvas nenhuma tecla é consumida | 1 teste |
| T1.10 | Variante veículo (comparação) | E | 20 min | T0.7, T1.1 | `G:sources\Game\Physics\PhysicsVehicle.js` (quarentena) | Carrinho de caixas cinza no mesmo greybox (`?loco=vehicle`) | Percorre o greybox por ghost | 1 ghost |
| T1.11 | Matriz de backends | E | 25 min | T1.6 | `Rendering.js` | `?webgpu` e `?webgl` em desktop e no celular do dono; o celular usa **WebGL2 por padrão** | Tabela fps/erros por backend × aparelho em `G:NOTICE.md` | 1 run por célula |
| T1.12 | Vídeos de comparação + publicação | E | 20 min | T1.2–T1.11 | `G:tools\capture\runs\g1\` | 4 vídeos (a pé e veículo × desktop e retrato), preview publicado | Vídeos + métricas + URL de preview prontos para o dono | 1 run cada |
| T1.13 | Revisão do controlador | R | 20 min | T1.2–T1.9 | — | Passo fixo, interpolação, quinas, teto, plataforma | Nenhum achado "alto" aberto | — |

**Gate G1** (dono): joga as duas variantes no preview (desktop + celular, com os dois backends) e preenche o formulário. Decide D1, D12 e D17. A afinação vai para `feel.js`. **Binários do greybox entram no `main` aqui.**

Paralelismo da Fase 1:
- T1.1 → T1.2 → (T1.3 ∥ T1.5 ∥ T1.6 ∥ T1.10)
- → (T1.4 ∥ T1.7 ∥ T1.8 ∥ T1.9 ∥ T1.11)
- → T1.12 → T1.13

**Total da Fase 1: 13 tarefas.**

### Fase 2: Fatia vertical "Origens" (≈ 5–7 semanas de calendário, com 3 rodadas de iteração de arte e os gates GA, GB e G2)

**2A. Fundação da arte**

| ID | Entregável | Papel | Dur. | Deps | Arquivos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|
| T2.1a | `vn_scene.py` + `vn_export.py` (unidades, coleções, export com custom props) | E | 25 min | T0.1 | `G:blender\lib\` | Um empty com `mass=2` chega ao `userData.mass` no three | 1 export |
| T2.1b | `vn_shapes.py` + `vn_bevel.py` (blob, caixa arredondada, tubo, fita, weighted normals) | E | 30 min | T2.1a | `G:blender\lib\` | Render de 3 vistas das 4 formas sem artefato de normal | 1 render |
| T2.1c | `vn_collide.py` + `vn_refs.py` (`trimesh*`/`hull*`/`cuboid*`, `ref*`) | E | 25 min | T2.1a | `G:blender\lib\` | O greybox regerado com a lib carrega com os mesmos colisores e refs da T1.1 | 1 run |
| T2.1d | **Overrides manuais** (R1): `blender/manual/<asset>.blend` substitui a malha gerada pelo nome | E | 25 min | T2.1a | `G:blender\lib\vn_manual.py`, `G:blender\manual\README.md` | Um cubo editado à mão em `manual/` sobrevive a uma regeração completa | 1 regeração |
| T2.2 | Paleta 16×16 + calibração de cor | E | 25 min | T2.1a, T0.6 | `G:blender\palette\*`, `G:static\palette.png` | ΔE2000 < 3 para cada swatch na cena `?debug=palette` (tone mapping registrado) | 1 medição |
| T2.3a | AO no vértice | E | 30 min | T2.1b | `G:blender\lib\vn_bake_ao.py`, `MeshDefaultMaterial.js` | Greybox com AO lido de `COLOR_0` visível nas quinas (vídeo de 10 s) | 1 gravação |
| T2.3b | Sombra estática top-down para o Q1 | E | 30 min | T2.3a | `vn_bake_shadow.py`, `MeshDefaultMaterial.js` | No Q1 sem shadow map, as sombras estáticas aparecem e o frame time do proxy móvel cai (números antes e depois registrados) | 1 medição |
| T2.4 | Compressão meshopt + PNG/WebP sem perda + integração com o manifesto | E | 25 min | T2.1a, T0.15 | `G:scripts\compress.mjs` | Greybox comprimido ≥ 60% menor e carregado pelo manifesto com hash | 1 build |

**2B. Direção de arte do personagem (gate GA antes de modelar)**

| ID | Entregável | Papel | Dur. | Deps | Arquivos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|
| T2.A1 | 3 silhuetas do Victor (render chapado em tinta, frente e perfil) a partir de D3 | E | 30 min | T2.1b, D3 | `G:blender\character\silhouettes.py` | 3 opções distintas entregues ao dono | 1 render |
| T2.A2 | Turnaround colorido (frente, 3/4, perfil, costas) da silhueta escolhida | E | 30 min | GA-1 (escolha) | `G:blender\character\turnaround.py` | Folha de referência aprovada pelo dono (até 3 rodadas, cada uma é uma tarefa nova de ≤ 30 min) | 1 render |

**Gate GA** (dono): escolhe a silhueta (GA-1) e aprova o turnaround (GA-2). Sem GA, a T2.5a não começa.

**2C. Personagem**

| ID | Entregável | Papel | Dur. | Deps | Aceite (único) | Validação |
|---|---|---|---|---|---|---|
| T2.5a | Blockout de cabeça e cabelo (topete) | E+ | 30 min | GA | Sobreposição com o turnaround: desvio de silhueta ≤ 5% em pixels | 1 render |
| T2.5b | Blockout de corpo, roupa, mochila e cachecol | E+ | 30 min | T2.5a | Altura 1.20 m e 2.6 cabeças medidas no script | 1 render |
| T2.5c | Detalhe + UV de paleta + olhos e boca por UV | E+ | 30 min | T2.5b | ≤ 6 mil tris e 2 materiais | `gltf-transform inspect` |
| T2.5d | Casco de contorno + checklist de trade dress + export | E | 20 min | T2.5c | Checklist (sem boné, macacão, bigode ou luvas) assinada pelo revisor | 1 export |
| T2.6 | Rig de 24 bones + pesos | E | 30 min | T2.5d | A pose extrema de teste não rasga (3 renders) | 1 render |
| T2.7a | Clipes `idle`, `walk` e `run` | E+ | 30 min | T2.6 | Run sem pé deslizando a 7 m/s (ghost `run` com o Victor real) | 1 ghost |
| T2.7b | Clipes `jumpUp`, `fall`, `landSoft` e `landHard` | E+ | 30 min | T2.6 | O ghost `jumpArc` troca os clipes nos frames certos (log de estado) | 1 ghost |
| T2.8a | Clipes `skid`, `flutter` e `stamp` | E+ | 30 min | T2.7b | Os 3 clipes tocam nos ghosts `skid`/`jumpArc`/`stamp` | 1 ghost |
| T2.8b | Clipes `push`, `grind`, `interact` e `hurtBump` | E+ | 30 min | T2.7b | Os 4 clipes existem no glb com os nomes certos | 1 export |
| T2.8c | Clipes `wave`, `celebrate`, `idleLong` e `sitLaptop` | E+ | 30 min | T2.7b | Os 4 clipes existem no glb com os nomes certos | 1 export |
| T2.8d | Turntable de 40 s com os 18 clipes para o gate GB | E | 15 min | T2.8a–c | Vídeo entregue | 1 vídeo |
| T2.9a | `CharacterVisual`: máquina de estados + crossfades + `timeScale` | E+ | 30 min | T2.7a, T1.3 | Log de transições do ghost `first10s` sem estado inválido | 1 ghost |
| T2.9b | Camadas procedurais (lean, squash, look-at, cachecol em molas, piscar) | E+ | 30 min | T2.9a | Vídeo de 20 s com as 5 camadas ativas e desligáveis no `?debug` | 1 gravação |
| T2.IT1 | Rodada de iteração 2 do Victor (notas do dono, ≤ 6 itens) | E+ | 30 min | GB | Itens fechados | 1 render + 1 vídeo |
| T2.IT2 | Rodada de iteração 3 do Victor (≤ 6 itens) | E+ | 30 min | T2.IT1 | Itens fechados | 1 render + 1 vídeo |

**Gate GB** (dono): aprova modelo e animação pelo turntable. Se reprovar depois da IT2, entra mais iteração com procedural. **Mixamo só se o dono pedir explicitamente** (D3b).

**2D. Mundo de Origens**

| ID | Entregável | Papel | Dur. | Deps | Aceite (único) | Validação |
|---|---|---|---|---|---|---|
| T2.10 | Blockout da planta (O1–O11 + Linha + `refNav*`) | E | 30 min | **T2.1c, T1.3, T1.6, T0.16** | Ghosts `first10s` e `contact30` cumprem 5 s / 15 s / 30 s no greybox da era | 2 ghosts |
| T2.11 | Kit do cerrado (buriti, ipê 2 estados, pequizeiro, capim base, cupinzeiro, rocha, flores) | E | 30 min | T2.1b, T2.2 | Renders das 7 peças dentro dos tris da 5.4 | 1 render |
| T2.12 | Kit plataforma (bloco de marco, tijolo, cano de cobre, sinal, placa, caixote) + **checagem de trade dress** | E | 30 min | T2.1b, T2.2 | Checklist assinada pelo revisor: cano não verde nem em forma de cano clássico, bloco sem "?", sinal sem forma de moeda dourada | 1 render |
| T2.13a | Casa natal + ipê (pop-up) | E+ | 30 min | T2.11 | Renders de 3 vistas | 1 render |
| T2.13b | CRT gigante + mesa, cadeira e teclado (plataformas, tela separada) | E+ | 30 min | T2.12 | Renders + a malha `screen` existe | 1 render |
| T2.13c | Escola + mastro + capelo | E+ | 30 min | T2.12 | Renders de 3 vistas | 1 render |
| T2.13d | Ponto de ônibus + mini-ilha provisória do ponto final | E | 25 min | T2.12 | Renders de 3 vistas | 1 render |
| T2.IT3 | Rodada 2 dos hero assets (notas do dono, ≤ 8 itens) | E+ | 30 min | GC | Itens fechados | 1 render |
| T2.IT4 | Rodada 3 dos hero assets (≤ 8 itens) | E+ | 30 min | T2.IT3 | Itens fechados | 1 render |
| T2.14a | Montagem da era + merge em ≤ 6 malhas + AO | E | 30 min | T2.10, T2.13a–d, T2.3a | ≤ 6 malhas visuais | `gltf-transform inspect` |
| T2.14b | Altura do terreno + máscaras de dados (PNG/WebP sem perda) + sombra top-down | E | 30 min | T2.14a, T2.3b | Máscaras sem perda e com ≤ 250 KB juntas | 1 build |
| T2.14c | Export + compressão + orçamento | E | 15 min | T2.14b, T2.4 | Era ≤ 850 KB (6.5) no `check-size` | 1 gate |
| T2.15a | Terreno + capim | E | 30 min | T2.14c | O capim se curva com o Victor, e no Q1 a densidade é ≤ 40% do Q0 | 1 gravação |
| T2.15b | Folhagem + água do Rio Tocantins | E | 25 min | T2.14c | Vídeo de 10 s com água na cor da era | 1 gravação |
| T2.16 | `EraCycles` + céu e névoa do amanhecer | E | 25 min | T2.14c | Preset Origens aplicado e interpolação testada com um preset fictício | 1 gravação |

**Gate GC** (dono): olha os renders dos hero assets (rodada 1) e manda notas para T2.IT3/IT4. O dono pode editar qualquer `.blend` à mão, e a T2.1d preserva a edição.

**2E. Jogabilidade e conteúdo**

| ID | Entregável | Papel | Dur. | Deps | Aceite (único) | Validação |
|---|---|---|---|---|---|---|
| T2.17 | Marcos + cards (`<dialog>` do `content.json`) | E | 30 min | T0.12, T1.3 | Os 3 cards abrem, o foco vai ao título e volta ao canvas no Esc (teste Playwright) | 1 teste |
| T2.18a | A Linha em runtime (spline + malha de fita + colisor de sensor) | E | 30 min | T2.14c | O sensor detecta o Victor no ar ao longo dos 100% da fita | 1 ghost |
| T2.18b | Estado de grind (entrar, velocidade 9–14 m/s, sair pulando) | E+ | 30 min | T2.18a | Ghost `grind`: atravessa Origens em ≤ 8 s | 1 ghost |
| T2.18c | Efeitos do grind (faíscas, cachecol brilhando, ganchos de som) | E | 20 min | T2.18b | Vídeo de 10 s | 1 gravação |
| T2.19a | Set piece: casa pop-up + ipê florindo | E | 30 min | T2.17 | Sequência ≤ 2.5 s pulável (vídeo) | 1 gravação |
| T2.19b | Set piece: CRT liga + página pixelada "Ponto Interativo" (256×192, Python/PIL, arte original) | E | 30 min | T2.17, T1.4 | O carimbo no botão liga a tela (vídeo) | 1 gravação |
| T2.19c | Set piece: o capelo voa e vira acessório | E | 25 min | T2.17 | O capelo fica preso ao bone `head` até sair da era (vídeo) | 1 gravação |
| T2.20a | 20 sinais instanciados + contador no HUD | E | 25 min | T2.14c | O ghost `origensFull` coleta 17 sinais visíveis e o HUD bate | 1 ghost |
| T2.20b | Segredo do cupinzeiro + quartinho | E | 30 min | T2.20a, T1.4 | O segredo abre com planada + carimbo (ghost `secret`) | 1 ghost |
| T2.20c | Cano de contato → ponto final provisório → card de contato | E | 25 min | T2.17 | Ghost `contact30` < 30 s | 1 ghost |
| T2.21a | Breakables (caixotes de pequi, cercas) | E | 30 min | T2.14c | 10 repetições sem nada atravessar o chão | 1 ghost × 10 |
| T2.21b | Vida ambiente (seriema, borboletas) + pegadas | E | 30 min | T2.14c | Vídeo de 30 s | 1 gravação |
| T2.NAV | Rota de **auto-walk** (grafo de `refNav*` + spline da Linha) para "Ir até" | E+ | 30 min | T2.10, T2.17 | Da lista de marcos, "Ir até" leva a cada um dos 3 marcos e ao contato sem travar (ghost `nav`) | 1 ghost |

**2F. Som**

| ID | Entregável | Papel | Dur. | Deps | Aceite (único) | Validação |
|---|---|---|---|---|---|---|
| T2.22 | Curadoria de sfx e ambiente com licença verificável | A | 30 min | — | Tabela com URL, licença e autor de 30 sfx + 2 ambiências (música só se D4 estiver decidida) | — |
| T2.23 | Arquivos de áudio prontos + `LICENSES-AUDIO.md` | E | 30 min | T2.22 | Comum + Origens ≤ 750 KB, normalizados | 1 medição de loudness |
| T2.24a | Passos por superfície + pulo + aterrissagem | E | 25 min | T2.23, T2.9a | Nenhum som se repete idêntico 3× seguidas (log de rate e volume) | 1 vídeo |
| T2.24b | Interações (bloco, card, carimbo, grind por velocidade, pluck por marco) | E | 30 min | T2.24a, T2.18b | Os 5 eventos tocam no vídeo do `origensFull` | 1 vídeo |
| T2.24c | Ambiência + música (se D4) + ducking no card | E | 25 min | T2.24b | Ducking de −8 dB medido com o card aberto | 1 vídeo |

**2G. Carga, UI e acessibilidade**

| ID | Entregável | Papel | Dur. | Deps | Aceite (único) | Validação |
|---|---|---|---|---|---|---|
| T2.25a | Loader da Linha (HTML/CSS, progresso por bytes do manifesto) | E | 25 min | T0.15 | A barra chega a 100% exatamente quando o último byte crítico chega (log) | 1 run |
| T2.25b | Reveal pop-up + câmera inicial + aceno cancelável | E | 30 min | T2.25a, T2.9a | Controle ≤ 0.8 s após o reveal (ghost `first10s`) | 1 ghost |
| T2.25c | Passe de tempo do storyboard dos 10 s | E | 20 min | T2.25b, T2.19a | Marcas da 2.7 batem ±0.3 s no `metrics.json` | 1 ghost |
| T2.26 | HUD, menu e opções + tokens e contraste | E | 30 min | T2.17 | Retrato e paisagem com alvos de 44 px **+ aceite fixo da raiz** (pares novos em `T:tokens\` e `T:dtcg-contrast.config.json`) | 1 teste + 1 Lighthouse |
| T2.27a | Announcer `aria-live` + lista de marcos | E | 30 min | T2.17, T2.NAV | Roteiro NVDA: era, proximidade e marco anunciados | 1 roteiro |
| T2.27b | Movimento reduzido + **Pausar** (WCAG 2.2.2) + checagem de flashes (2.3.1) | E | 30 min | T2.26 | `flash-check.mjs` (ffmpeg `signalstats`: no máximo 3 transições de luminância por segundo em área ≥ 25%) passa no vídeo do `origensFull` + o carimbo de tela inteira | 1 vídeo |
| T2.27c | Alternativas de ponteiro único em toda a UI do 3D (2.5.7) + axe | E | 25 min | T1.8, T2.26 | axe-core com 0 violações e fluxo completo só com toques simples | 1 run axe + 1 teste |
| T2.28 | `ZoneStreamer` | E | 30 min | T2.14c | 3 ciclos de carga e descarga com memória ±5% e colisores removidos | 1 run |

**2H. Qualidade, performance e publicação**

| ID | Entregável | Papel | Dur. | Deps | Aceite (único) | Validação |
|---|---|---|---|---|---|---|
| T2.29 | Tiers Q0/Q1/Q2 + adaptação + **WebGL2 forçado no celular** até D17 | E | 30 min | T2.15a, T2.16, T1.11 | Troca automática de tier com p90 > 18 ms por 3 s (teste com atraso artificial) | 1 teste |
| T2.30a | Passe de draw calls (merge e instancing) | E | 30 min | T2.29, T2.21a | ≤ 120 draw calls no Q1 em toda a era (log do ghost) | 1 ghost |
| T2.30b | Passe de shader, overdraw e resolução no Q1 | E | 30 min | T2.30a | Proxy da 7.5 verde (main ≤ 8 ms, contadores) | ≤ 3 medições |
| T2.30c | Medição no celular do dono | dono + E | 30 min | T2.30b | Celular real ≥ 55 fps médio e p95 ≤ 20 ms (trace remoto + gravação de tela) | 1 sessão |
| T2.31a | Gravações desktop (WebGPU e `?webgl`, 1440p): ghosts `first10s`, `contact30` e `origensFull` | E | 25 min | T2.30b | 3 vídeos + `metrics.json` dentro da 7.4 | 1 run cada |
| T2.31b | Gravações no proxy móvel (retrato e paisagem) | E | 25 min | T2.30b | 4 vídeos + `metrics.json` dentro da 7.4 | 1 run cada |
| T2.31c | Relatório da rubrica com evidência | R | 25 min | T2.31a–b, T2.30c | Notas por dimensão com link para vídeo/métrica e lista do que impede o 10 | — |
| T2.32 | Auditoria de originalidade + **comparação humana lado a lado** | R + dono | 25 min | T2.31c | `audit-originality` = 0 e contact sheets nossas vs. as do Bruno (T0.4) lado a lado: o dono responde "não lembra reskin" | 1 run + 1 olhada |
| T2.33 | Publicar a fatia no preview + roteiro de playtest | E | 15 min | T2.32 | `npm run gate` verde e URL de preview + `PLAYTEST.md` (o que testar, formulário, aparelho) entregues | 1 publicação |

**Gate G2** (dono): playtest desktop + celular real, com o formulário (T0.17). Passa com **todas as dimensões aplicáveis à fatia ≥ 9 e média ≥ 10**. A dimensão "música" só conta se D4 estiver decidida antes da T2.22. Senão, sai da nota e fica registrada como pendência.
- Se reprovar: no máximo 2 rodadas de ajuste. Cada rodada é uma lista do dono de ≤ 10 itens, quebrada em tarefas de ≤ 30 min (T2.FIX1-n e T2.FIX2-n).
- **Binários da fatia entram no `main` aqui.**

Paralelismo da Fase 2:
- 2A → (2B ∥ 2D até T2.13d)
- 2C depois de GA
- 2F desde o início
- 2E depois de T2.14c
- 2G depois de T2.17
- 2H no fim

**Total da Fase 2: 75 tarefas** (2A 8, 2B 2, 2C 15, 2D 15, 2E 13, 2F 5, 2G 8, 2H 9), mais até 2 rodadas de ajuste.

### Fase 3: Expandir as eras (≈ 8–10 semanas de calendário)

**Molde por era `X`** (13 tarefas; `<era>` = `unicamp`, `industria`, `alemanha`, `dados`, `transformacao` ou `hub`).

| Passo | Entregável | Papel | Dur. | Deps | Arquivos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|
| X.1 | Blockout + refs + Linha + `refNav*` | E | 30 min | G2; T2.1c | `G:blender\eras\<era>.py` | Primeiro marco da era < 15 s após a chegada (ghost) | 1 ghost |
| X.2 | Kit A (vegetação/ambiente) | E | 30 min | X.1 | `G:blender\kits\<era>_kit.py` | Renders dentro dos tris da 5.4 | 1 render |
| X.3a | Landmark 1 (modelo) | E+ | 30 min | X.1 | `G:blender\kits\<era>_landmarks.py` | Renders de 3 vistas | 1 render |
| X.3b | Landmark 2 (modelo) + colisores dos dois | E+ | 30 min | X.3a | idem | Colisores corretos no wireframe | 1 abertura |
| X.4 | Montagem + AO + terreno + máscaras + compressão | E | 30 min | X.2, X.3b | `G:static\eras\<era>\*` | Era ≤ 850 KB e ≤ 6 malhas | 1 gate |
| X.5 | Luz, céu, névoa + transição | E | 25 min | X.4 | `EraCycles.js` | Transição sem tranco em vídeo | 1 gravação |
| X.6a | Set piece 1 | E+ | 30 min | X.4 | `G:sources\Game\World\Eras\<Era>Era.js` | Vídeo do set piece | 1 gravação |
| X.6b | Set piece 2 | E+ | 30 min | X.6a | idem | Vídeo do set piece | 1 gravação |
| X.6c | Marcos (cards) + segredo | E | 30 min | X.4, T2.17 | idem | Cards com paridade e segredo aberto por ghost | 1 ghost |
| X.7 | Áudio da era (com licença) | E | 30 min | X.4, T2.24c | `G:static\sounds\<era>\*` | Log de licença completo | 1 vídeo |
| X.8 | Gravação + perf + proxy móvel | E | 30 min | X.5–X.7 | — | Gates da 7.4 | ≤ 3 medições |
| X.9a | Iteração 2 de arte (notas do dono, ≤ 8 itens) | E+ | 30 min | X.8 | arquivos da era | Itens fechados | 1 render |
| X.9b | Iteração 3 de arte (≤ 8 itens) | E+ | 30 min | X.9a | arquivos da era | Itens fechados | 1 render |

Instâncias:
- **UNICAMP:** T3.U1–T3.U13 (nanotubos, rua das ONGs, empresa júnior).
- **Indústria:** T3.I1–T3.I13 (esteiras, garrafas genéricas, trainee).
- **Alemanha:** T3.A1–T3.A6 (molde reduzido: X.1, X.3a, X.4, X.5, X.8, X.9a).
- **Dados:** T3.D1–T3.D13 (barras vivas, regressão).
- **Transformação digital + praça de projetos:** T3.T1–T3.T13, mais **T3.T14**: imagens dos 6 projetos (WebP 1200×675 ≤ 60 KB, D11).
- **Hub e ponto final:** T3.H1–T3.H6 (molde reduzido: X.1, X.3a, X.4, X.5, X.6a, X.8).

Integração:

| ID | Entregável | Papel | Dur. | Deps | Arquivos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|
| T3.X1 | Anel completo com transições (ônibus, ponte da Linha, dirigível) | E | 30 min | todas as eras | `G:sources\Game\World\Transitions.js` | Ghost de jornada completa sem tranco e com transições puláveis | 1 ghost |
| T3.X2 | Streaming do anel inteiro | E | 30 min | T3.X1, T2.28 | `ZoneStreamer.js` | 3 voltas com memória ±5% | 1 run |
| T3.X3 | (Opcional, D1 = C) empilhadeira original com `PhysicsVehicle` | E | 30 min | T3.I8 | `G:blender\kits\industria_forklift.py` | Dirige por ghost sem asset do upstream | 1 ghost |
| T3.X4 | Revisão da Fase 3 | R | 20 min | T3.X1–X3 | — | Nenhum "alto" aberto | — |

**Gate G3** depois de UNICAMP + Indústria (as duas podem correr em paralelo em executores diferentes, cada um nos seus arquivos). **Binários entram no `main` aqui.**

**Total da Fase 3:** 13 (U) + 13 (I) + 6 (A) + 13 (D) + 14 (T) + 6 (H) + 4 (X) = **69 tarefas.**

### Fase 4: Polimento e performance (≈ 2–3 semanas de calendário)

| ID | Entregável | Papel | Dur. | Deps | Arquivos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|
| T4.1 | Conquistas locais (sem servidor) | E | 30 min | T3.X2 | `Achievements.js`, `G:sources\data\achievements.js` | 8 conquistas, nenhuma bloqueia conteúdo | 1 teste |
| T4.2 | Mapa em estilo cordel com teleporte | E | 30 min | T3.X2 | `Map.js`, `G:static\ui\map.svg` | Navegável só por teclado e só por toque simples | 1 teste |
| T4.3 | Mix final de áudio | E | 30 min | T3.X1 | `Audio.js` | 10 min sem pico acima de −1 dBTP (`ebur128`) | 1 medição |
| T4.4 | Música final (D4) | E | 30 min | D4 | `G:static\sounds\music\*` | Licença registrada e −16 LUFS | 1 medição |
| T4.5a–h | "Juice": **no máximo 8 itens**, a lista é fechada no G3 (cada item é uma tarefa de ≤ 30 min). O excedente vai para o backlog pós-lançamento. | E+ | ≤ 8 × 30 min | G3 | arquivos da era | Cada item com vídeo antes e depois | 1 vídeo por item |
| T4.6 | Perf desktop | E | 30 min | T3.X2 | `Rendering.js`, `Quality.js` | `perf-gate` desktop verde | ≤ 3 medições |
| T4.7 | Perf mobile (anel inteiro, 5 min de térmico no aparelho do dono) | E + dono | 30 min | T4.6 | idem | Seção 7.5 verde | 1 sessão |
| T4.8 | Auditoria de acessibilidade completa | R | 30 min | T4.1, T4.2 | — | axe 0 + roteiro NVDA + 2.5.7, 2.3.1 e 2.2.2 OK | 1 run |
| T4.9 | Teste com 3 pessoas | dono | 30 min | T4.7 | `T:docs\PLAYTEST.md` | Formulários registrados | — |
| T4.10a–f | Correções do T4.9: **no máximo 6 itens**, lista fechada no T4.9 | E | ≤ 6 × 30 min | T4.9 | conforme a lista | Cada item com ghost de evidência | 1 ghost por item |
| T4.11 | Gravação final da rubrica | E + R | 30 + 25 min | T4.10 | `G:tools\capture\runs\final\` | Relatório com evidência de ≥ 3 dimensões em 11 | 1 run por perfil |
| T4.12 | Auditoria final de originalidade, licenças e segurança + **comparação humana lado a lado** | R + dono | 25 min | T4.11 | — | Script = 0 e o dono responde "não lembra reskin" | 1 run |

**Total da Fase 4: 10 tarefas fixas + até 8 (T4.5) + até 6 (T4.10) = até 24 tarefas.**

### Fase 5: Lançamento (≈ 1–1.5 semana de calendário, incluindo a janela de rollback)

| ID | Entregável | Papel | Dur. | Deps | Arquivos | Aceite (único) | Validação |
|---|---|---|---|---|---|---|---|
| T5.1 | `build:play` → `T:play\` (sem `noindex`, com canonical e OG) | E | 20 min | T4.12 | `G:vite.config.js`, `T:play\**` | `npm run gate` verde | 1 build |
| T5.2 | Start do 2D navega para o alvo da flag `START_TARGET` (`'./play/'`) com prefetch por intenção; pôster novo | E | 30 min | T5.1 | `T:src\boot.js`, `T:index.html`, `T:assets\**` | O 3D não é requisitado antes do clique **+ aceite fixo da raiz** | 1 log de rede + 1 Lighthouse |
| T5.2b | **Rollback documentado:** `T:docs\ROLLBACK.md` com (1) `git revert <sha>` do lançamento e (2) a linha única `START_TARGET = 'legacy'`, que volta ao 3D antigo (ainda presente) | E + R | 20 min | T5.2 | `T:docs\ROLLBACK.md`, `T:src\boot.js` | Ensaio local: trocar a flag volta ao 3D antigo em 1 build | 1 ensaio |
| T5.3 | **Depois de 7 dias sem rollback:** mover `src/world/*` e `assets/js/world/*` para `D:\GitHub\pode_apagar\timeline\…`, `git rm`, simplificar os scripts da raiz | E | 20 min | T5.2b + 7 dias | esses arquivos | Nada apagado sem cópia **+ aceite fixo da raiz** | 1 check + 1 Lighthouse |
| T5.4 | SW `VERSION v9` + revisão do bypass | E + R | 15 + 15 min | T5.1 | `T:worker.js` | `play/` fora do cache **+ aceite fixo da raiz** | 1 teste |
| T5.5 | README (README-SPEC) + `LICENSES.md` final | E | 30 min | T5.2 | `T:README.md`, `T:LICENSES.md` | Checklist da spec OK | 1 leitura |
| T5.6 | JSON-LD + OG do `play/` | E | 20 min | T5.1 | `G:sources\index.html` | Validador OG sem erro | 1 validação |
| T5.7 | Revisão final | R | 25 min | T5.1–T5.6 | — | Nenhum "alto" | — |
| T5.8 | **Gate G4:** o dono aprova e a sessão principal faz commit e push | dono | — | T5.7 | — | Live atualizado e smoke test OK | 1 smoke |
| T5.9 | Limpeza dos documentos internos | E | 25 min | T5.8 | `T:docs\**` | Remover `docs/PLAN-3D.md` do repositório (e o que mais for só de planejamento); reescrever os documentos que ficam (inventário do motor, baseline, rubrica) **sem citar Bruno Simon**, usando termos neutros ("motor base", "site de referência"); o crédito permanece apenas em `game/LICENSES.md` | `grep -ri "bruno\|folio" docs/` vazio; `LICENSES.md` intacto | 1 grep |

**Total da Fase 5: 9 tarefas.**

### Resumo de tarefas e esforço

| Fase | Tarefas | Calendário (com buffer de +35% e gates) |
|---|---|---|
| 0 Ferramentas e base | 18 | 2–3 dias |
| 1 Spike de locomoção | 13 | 3–4 dias |
| 2 Fatia vertical Origens | 75 (+ até 2 rodadas de ajuste) | 5–7 semanas |
| 3 Expansão | 69 | 8–10 semanas |
| 4 Polimento | até 24 | 2–3 semanas |
| 5 Lançamento | 9 | 1–1.5 semana |
| **Total** | **até 208** | **≈ 4–5 meses** |

---

## 9. Riscos, mitigações e decisões do dono

### 9.1 Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | **Qualidade da modelagem por `bpy`** fica "programática" (de novo primitivas) | Alta | Alto | Biblioteca de formas com bevel, blobs, remesh e weighted normals (T2.1). Render de 3 vistas por asset com revisão antes da montagem. Landmarks com script próprio. O dono pode retocar o `.blend` gerado, e o script aceita "overrides" manuais por nome (a malha editada à mão é preservada se existir em `blender/manual/`). |
| R2 | **Animação por keyframes em script** sem vida | Alta | Alto | A camada procedural faz metade do trabalho (5.6). Plano B: mais iteração + procedural. Mixamo só com opt-in explícito do dono (D3b). Gate GB. |
| R3 | **Mobile no backend WebGL2 do `WebGPURenderer`** abaixo da meta | Média | Alto | Proxy móvel desde a Fase 1 (`?webgl&q=1`). Sombra bakeada no Q1. ≤ 120 draw calls. Escala de resolução dinâmica. Celular real no G1, não só no G2. Último recurso: build Q2 sem pós e sem capim denso. |
| R4 | **Peso inicial** (Rapier 1.17 MB + three) em 4G | Média | Médio | Prefetch por intenção, streaming por era, loader que já é a experiência (a Linha). Verificar o gzip no Pages (T0.11). Se o `.wasm` não comprimir, usar o compat. |
| R5 | **Parecer reskin do Bruno** | Média | Alto | Locomoção a pé (D1). A fronteira de reuso da 6.3. A auditoria de hashes e strings. Nada de UI, fonte, som, paleta ou layout do upstream. Uma checagem humana no G2: "lembra o site do Bruno?" tem que dar não. |
| R6 | **Escopo** (121 tarefas) | Alta | Médio | A fatia vertical é o produto mínimo lançável: se a Fase 3 atrasar, dá para lançar só Origens + hub com os demais marcos acessíveis pela lista/cards. Gates G2 e G3 cortam escopo, não qualidade. |
| R7 | **Divergência com o upstream** (bugs do motor) | Baixa | Médio | O código copiado vira nosso. Não há merge automático. O `NOTICE.md` registra o commit `70764a9` de origem. |
| R8 | **Licenças de terceiros** (áudio, GSAP, eventual Mixamo) | Média | Médio | Log de licença obrigatório por arquivo. Revisor na T2.32 e na T4.12. Na dúvida, não usar. |
| R9 | **Inchaço do repositório** | Média | Baixo | Previews num repo separado com commit órfão forçado (6.1). Binários no `main` só nos gates. Só os `.blend` de override manual entram no git. `git count-objects -vH` a cada gate. |
| R10 | **SW servindo build velho** | Baixa | Médio | T0.10 (bypass) e o versionamento. |
| R11 | **Diferença de cor** entre Blender e three | Média | Médio | Calibração ΔE < 3 na T2.2, paleta como verdade, tone mapping neutro. |
| R12 | **Avaliação inflada** de novo | Média | Alto | 7.1: vídeo + métricas + playtest humano. Nota de "feel" só do dono, com o mesmo formulário usado para o Bruno. |
| R13 | **Mistura de versões em cache** (o Pages guarda ~10 min) | Média | Alto | Nomes com hash + manifesto (T0.15). O HTML é o único arquivo sem hash. |
| R14 | **Estimativas otimistas** | Alta | Médio | Buffer de +35% por fase, rodadas de iteração já orçadas (IT1–IT4, X.9a/b) e tetos explícitos em T4.5/T4.10 |

### 9.2 Decisões que dependem do gosto do dono (com padrão para não travar)

| ID | Decisão | Padrão recomendado (o trabalho segue com ele) | Quando decidir |
|---|---|---|---|
| D1 | Locomoção: a pé + grind (B), veículo (A) ou híbrido (C) | **B**, com C opcional na Fase 3 | G1 |
| D2 | Iluminação: paleta + Lambert estilizado + AO no vértice + sombra bakeada no celular, ou lightmaps Cycles completos | **Paleta + AO + sombra bakeada no Q1** | Antes da T2.3 (padrão já vale) |
| D3 | Semelhança do avatar: cabelo, óculos, barba, tom de pele, porte | Topete preto, sem óculos, sem barba, pele `#c98d6a`, porte médio. O dono pode mandar 2–3 fotos ou uma descrição. | Antes da T2.5a |
| D3b | Animações de terceiros (ex.: Mixamo) | **Não usar.** Script + procedural + rodadas de iteração. Só com pedido explícito do dono. | GB |
| D4 | Música: (a) encomenda a um músico; (b) composição procedural/generativa própria (WebAudio com timbres sintetizados ou samples CC0 de instrumentos); (c) faixa CC0 **se** a curadoria achar uma boa. Não dá para presumir que existe um baião CC0 bom. | **Decidir antes da T2.22.** Sem decisão, a fatia vai **sem música** e a música sai da nota do G2. Recomendação para o lançamento: (a). | Antes da T2.22 |
| D5 | Deploy de preview | **Repo de preview separado (`voaneves/timeline-preview`) com commit órfão forçado.** Produção em `play/` no `main` só no G4. | Antes da T0.11 |
| D6 | GSAP (licença própria "no charge") | **Manter e registrar**, ou trocar pelos tweens próprios se o dono preferir 100% OSI | T0.5 |
| D7 | Entrada no 3D: documento separado `play/` | **Sim** | Agora |
| D8 | Tom dos textos no mundo (placas de cordel, piadas leves) | Voz da marca (direto, caloroso, sem exclamação na UI); placas curtas | T2.19 |
| D9 | Crédito visível ao motor do Bruno | **Sim**, no menu, na sala de bastidores, no `LICENSES.md` e no README (exigência do dono) | Já decidido |
| D10 | Celular(es) do teste real | O aparelho principal do dono + qualquer Android médio disponível | Antes do G1 |
| D11 | Imagens dos projetos (capturas das páginas live) | Capturas automáticas WebP 1200×675 revisadas pelo dono | Fase 3 (T3.T*) |
| D12 | Qualidade padrão no celular e WebGPU no celular | Q1 + WebGPU quando houver (auto), com `?webgl` como fallback | G1 |
| D13 | Idioma | Só pt-BR (en depois) | — |
| D14 | Lançar só com Origens + hub se a Fase 3 atrasar | Sim, com os outros marcos acessíveis por cards/lista | G2 |
| D15 | Cor e forma dos canos | **Cobre e tinta com anel vermelho** (homenagem reinterpretada). O verde clássico só se o dono quiser assumir o risco de trade dress. | Antes da T2.12 |
| D16 | Medir a conversão do contato | **Nenhuma medição na fatia.** Depois, se o dono quiser: contador próprio sem cookies e sem terceiros (no estilo GoatCounter auto-hospedado), contando só cliques em "Falar com Victor". | G2 |
| D17 | Backend no celular | **WebGL2 forçado** até o WebGPU passar na matriz da T1.11 no aparelho do dono | G1 |

---

## 10. Definição de 11/10 (checklist)

- [ ] O dono jogou no desktop **e** no celular dele e deu ≥ 9 em todas as dimensões e média ≥ 10 no formulário (o mesmo que usou para o Bruno na T0.4), e disse "melhor que o Bruno" em pelo menos três: história, acessibilidade, mobile e personagem.
- [ ] Rubrica 7.3: todas ≥ 9, média ≥ 10, ≥ 3 dimensões nomeadas em 11 com evidência (vídeo + métricas).
- [ ] Primeiros 10 s: controle ≤ 0.8 s após o reveal, primeiro deleite < 5 s, primeiro marco < 15 s, contato < 30 s (ghosts `first10s` e `contact30`).
- [ ] Controle medido: apex 2.0 m ± 0.05 em 0.34 s, aceleração 0.14 s, frenagem 0.10 s, latência ≤ 1 frame. Um polegar joga no retrato e na paisagem.
- [ ] Desktop 1440p: 60 fps travado, GPU ≤ 6 ms. Celular real (WebGL2, com gravação de tela como evidência): ≥ 55 fps médio, p95 ≤ 20 ms, 5 min sem cair abaixo de 45.
- [ ] Transferência até o controle ≤ 3.0 MB, era crítica ≤ 850 KB (+ ≤ 350 KB de áudio depois), JS principal ≤ 420 KB gz, todos os assets com hash de conteúdo.
- [ ] Página 2D intacta: Lighthouse 100×4 e nada do 3D antes do clique.
- [ ] Acessibilidade: axe 0, teclado-only completo, lista de marcos + `aria-live`, movimento reduzido, contraste no gate (`npm run contrast`), alternativas de ponteiro único (2.5.7), sem flashes (2.3.1), Pausar (2.2.2) e auto-walk acessível.
- [ ] Originalidade: `audit-originality.mjs` = 0 arquivos do upstream. Nenhum som, modelo, textura, fonte ou layout do Bruno. Comparação humana lado a lado aprovada (T2.32, T4.12). Nada da Nintendo. Log de licenças completo.
- [ ] Atribuição MIT do folio-2025 no `LICENSES.md`, nos cabeçalhos, no menu e no README.
- [ ] Os 15 marcos, os 6 projetos e o contato do 2D aparecem no 3D com paridade testada.
- [ ] Rollback documentado e ensaiado (T5.2b) antes de aposentar o 3D antigo.
- [ ] Commit e push só com autorização, em commits pequenos Conventional Commits, sem atribuição de ferramenta e sem `Co-Authored-By`.
