# Plano de Transformação 3D — Portfólio & Timeline Interativa (Victor Neves)

- **Repositório:** raiz do clone `timeline` (origin `voaneves/timeline`, GitHub Pages em `https://voaneves.github.io/timeline/`)
- **Projeto 3D:** `./game` (base 3D instalada, dependências em `node_modules`, `.env` criado a partir de `.env.example`, build base validado)
- **Site raiz (intacto durante toda a evolução):** a raiz do repositório (`index.html`, `src/`, `assets/`, `docs/`)
- **Backup de referência (somente consulta eventual de textos/ideias; não usar como base):** `../pode_apagar/timeline/game_20261122`

## Status de execução

Atualizado em 2026-11-25.

| Fase | Tarefas | Estado |
| :--- | :--- | :--- |
| 0 a 3 | `T0.0`–`T0.3`, `T1.1`–`T1.5`, `T2.1`–`T2.3`, `T3.1`, `T3.2` | Feitas |
| 4 | `T4.0`–`T4.2` (`verify-glb`, letras `VICTOR NEVES`, limpeza `SocialArea`, totem geométrico, `areas-compressed.glb`) | Feitas |
| 5 | `T5.1`–`T5.2` (reorganização do layout e novo mapa 2D) | Pendentes (exigem Blender + confirmação D10) |
| 6 | `T6.1`–`T6.3` | Pendentes (`T6.1` exige `toktx` para `.ktx`) |

Ressalvas:
- Nada foi validado visualmente em GPU real; só `npm run build` e `npm run verify:glb -- --strict`.
- As edições da Fase 4 em `areas.glb` (`T4.1`–`T4.2`) foram geradas programaticamente via `game/scripts/patch-areas-phase4.mjs` + `compress.js static/areas` (Draco), dispensando Blender nesta etapa; os `.ktx` continuam dependendo do `toktx` (`T6.1`).
- `verify:glb -- --strict` passa com `0 erro(s), 0 aviso(s)` no `areas.glb` atual.
- Decisão 12 vs 13: a conquista `areas` conta 13 áreas (inclui `toilet`, sem pin); o contador do mapa mostra só as 12 com pin. `landing` (spawn) não dispara o aviso "Área descoberta".

---

## Sumário

- [0. Fatos Verificados e Auditoria Completa da Base](#0-fatos-verificados-e-auditoria-completa-da-base)
- [1. Princípios, Fronteira de Adaptação e Regra de Ouro de Assets](#1-princípios-fronteira-de-adaptação-e-regra-de-ouro-de-assets)
- [2. Direção Criativa e "Spin Próprio" (*Roadtrip Costeira Tátil*)](#2-direção-criativa-e-spin-próprio-roadtrip-costeira-tátil)
- [3. Jogabilidade, Física do Veículo, Câmera, Controles e Modo Offline-First](#3-jogabilidade-física-do-veículo-câmera-controles-e-modo-offline-first)
- [4. Mapeamento Cirúrgico das 14 Áreas e Level Design (Atual vs Novo Layout)](#4-mapeamento-cirúrgico-das-14-áreas-e-level-design-atual-vs-novo-layout)
- [5. Especificação Completa de Conteúdo (Victor Neves) e I18n](#5-especificação-completa-de-conteúdo-victor-neves-e-i18n)
- [6. Pipeline de Assets (`.glb` / `.ktx` / `.png` / `compress.js`) e Convenções Blender](#6-pipeline-de-assets-glb--ktx--png--compressjs-e-convenções-blender)
- [7. Arquitetura Técnica, Performance e Integração com o Site Raiz](#7-arquitetura-técnica-performance-e-integração-com-o-site-raiz)
- [8. Gates de Qualidade, Verificação Automatizada e Playtest](#8-gates-de-qualidade-verificação-automatizada-e-playtest)
- [9. Roadmap Granular com Tarefas Numeradas (`T0.0` a `T6.3`)](#9-roadmap-granular-com-tarefas-numeradas-t00-a-t63)
- [10. Matriz de Riscos, Decisões do Dono (`D1`–`D12`) e Checklist Final](#10-matriz-de-riscos-decisões-do-dono-d1d12-e-checklist-final)

---

## 0. Fatos Verificados e Auditoria Completa da Base

Todos os dados abaixo foram verificados diretamente no código-fonte de `D:\GitHub\_kit-clones\timeline\game`, nos binários `.glb` em `game/static/`, nos metadados de imagem via `sharp` e no DOM semântico de `D:\GitHub\_kit-clones\timeline\index.html`.

### 0.1 Núcleo do motor em `game/`
| Subsistema | Arquivos principais | Fatos verificados no código |
|---|---|---|
| Bootstrap & Recursos | `sources/Game/Game.js`, `ResourcesLoader.js` | Singleton `Game.getInstance()`. Carrega lote 0 (`respawnsReferencesModel`, `behindTheSceneStarsTexture`, `soundTexture`, `paletteTexture`), inicializa `WebGPURenderer` + `RenderPipeline`, depois carrega lote 1 (39 recursos) em paralelo com `@dimforge/rapier3d`. |
| Modo comprimido vs dev | `Game.js` l. 97–100, `game/.env` | `const compressed = !!import.meta.env.VITE_COMPRESSED`. Hoje `.env` tem `VITE_COMPRESSED=` (vazio), logo `Game.js` carrega `.glb` e `.png` brutos de `static/`. Com `VITE_COMPRESSED=1`, troca para `-compressed.glb` e `.ktx`. |
| Loop de prioridades | `Ticker.js`, `game/readme.md` | Prioridades determinísticas: `0` Time/Inputs → `1` Player pre → `2` PhysicsVehicle pre → `3` Physics → `4` Objects/Wireframe → `5` PhysicsVehicle post → `6` Player post → `7` View → `8` Intro/DayCycles/YearCycles/Weather/Zones/VisualVehicle → `9` Wind/Lighting/Tornado/InteractivePoints/Tracks → `10` Areas/Foliage/Fog/Reveal/Terrain/Trails/Floor/Grass/Leaves/Lightnings/Rain/Snow/WaterSurface/Props → `13` InstancedGroup → `14` Audio/Notifications/Title/Map → `998` Rendering → `999` Monitoring. |
| Render & Qualidade | `Rendering.js`, `Quality.js` | `THREE.WebGPURenderer` (com fallback automático para WebGL2). `Quality.level = 0` no desktop (`cheapDOF` + `bloom` 5 mips + shadow map `2048²` + hashBlur na água) e `1` no mobile via User-Agent (sem DOF + `bloom` 2 mips + shadow map `512²` + água sem blur). |
| Material & Iluminação | `MeshDefaultMaterial.js`, `Ligthing.js`, `Fog.js`, `Materials.js` | `MeshDefaultMaterial` (subclasse de `MeshLambertNodeMaterial` em TSL): aplica `paletteTexture` (`NearestFilter`), bounce da cor do terreno (`lightBounceDistance = 1.5`), linha branca na borda da água (`hasWater`), core shadow (`smoothstep` N·L), shadow map projetado (`receivedShadowNode`), cor de sombra tingida (`shadowColor`), névoa radial (`Fog.js`) e dissolve radial (`Reveal.js`). |
| Terreno & Água | `Terrain.js`, `Floor.js`, `Water.js`, `WaterSurface.js` | Mundo finito de `192 × 192 m` (`subdivision = 128`, `size = 192`). `terrain.png` (`512×512` RGBA): canal `R` = lajes (`slabs`), `G` = grama + sombra de grama (multiplicado pelas trilhas de pneu de `Tracks.js`), `B` = depressão/profundidade de água (`newPosition.y += terrainData.b * -1.5`). Colisão física do chão usa `heightfield` extraído de `terrain.glb` + `bedRock` cinemático para bordas externas. |
| Física & Veículo | `Physics.js`, `PhysicsVehicle.js`, `Player.js`, `VisualVehicle.js` | Rapier `@dimforge/rapier3d` `^0.19.3` (wasm via `vite-plugin-wasm`). Chassi dinâmico (`mass: 2.5`) com 3 cuboids (`Main`, `Top`, `Bumper`) + `world.createVehicleController` com 4 rodas, boost, freio, pulo, suspensão hidráulica, setas, luz de freio/ré, antena direcional, trails de boost, trilhas no solo e 6 pinturas desbloqueáveis. |
| Câmera | `View.js` | Câmera diorama suavizada com `focusPoint` + imã leve, zoom, modo cinemático (para `ProjectsArea` e `LabArea`), linhas de velocidade e modo livre (`#debug` + tecla `V` via `camera-controls`). |
| Áudio | `Audio.js`, `static/sounds/` | `Howler.js` com grupos (`playRandomNext`), anti-spam, atenuação espacial (`distanceFade`), variação de pitch (`rate`) e playlist instrumental ambiente com 3 faixas em `static/sounds/musics/`. |
| UI & Progresso | `Menu.js`, `Modals.js`, `Map.js`, `Options.js`, `Achievements.js`, `Notifications.js`, `InteractivePoints.js`, `Title.js` | Interface HTML/Stylus sobre o canvas com suporte a mouse/teclado, toque (`Nipple` + `InteractiveButtons`) e gamepad (Xbox/PS). Progresso de conquistas salvo em `localStorage` (`achievements`). |
| Build & Dependências | `package.json`, `vite.config.js` | Vite 8 (`root: 'sources/'`, `publicDir: '../static/'`, `outDir: '../dist'`, `base: './'`), Three.js `^0.187.0`, Rapier `^0.19.3`, GSAP `^3.15.1`, Howler `^2.2.4`, Stylus `^0.64.0`, Sharp `^0.34.5`, `@gltf-transform/cli` `^4.1.0`. |

### 0.2 Anomalias reais encontradas na auditoria (prioridade zero na Fase 0)
1. **BUG BLOQUEADOR — `game/sources/Game/World/Grass.js` está corrompido/misturado com um build anterior:**
   - A linha 6 do arquivo atual importa `./TerrainHeight.js`, que **não existe** em `game/sources/Game/World/` (confirmado por listagem completa do diretório). Além disso, o arquivo usa coordenadas fixas de um mapa antigo (`sampleExactTerraceY`, `OrigensGrassInstanced`).
   - **Impacto:** impede o `npm run dev` e `npm run build` de funcionarem corretamente.
   - **Solução (`T0.0`):** substituir `Grass.js` imediatamente por uma implementação limpa, 100% integrada ao `this.game.terrain.terrainNode` e `this.game.tracks` do motor atual, e validar build + runtime antes de iniciar qualquer outra tarefa.
2. **Script de Analytics legado em `game/sources/index.html` (linhas 45–52):**
   - Contém `<script async src="https://www.googletagmanager.com/gtag/js?id=G-JMSN30BQ5J"></script>` da base anterior. Remover na `T0.1`.
3. **Carregamento `.ktx` hardcoded ignorando `VITE_COMPRESSED` em 3 arquivos:**
   - `ProjectsArea.js` (l. 482): `this.game.resourcesLoader.getLoader('textureKtx')` + `projects.js` usando sufixo `.ktx`.
   - `LabArea.js`: mesmo padrão carregando `image` e `imageMini` em `.ktx`.
   - `Intro.js` (l. 151–153): `getLoader('textureKtx')` + `intro/${name}Label.ktx`.
   - **Impacto:** impede visualizar texturas `.png` editadas localmente em dev sem depender de `toktx`. Corrigir na `T0.3`.
4. **~136 MB de `.wav` não utilizados dentro de `game/static/sounds/musics/`:**
   - Existem 3 arquivos `.wav` (~45 MB cada) no `publicDir` ao lado dos `.mp3` (~6,2 MB cada) realmente carregados por `Audio.js`. O Vite copia tudo isso para `game/dist/` no build. Mover para `game/resources/sounds/musics/` na `T0.1`.
5. **Bugs de compatibilidade Windows no `game/scripts/compress.js`:**
   - Chama `spawn('gltf-transform', ...)` e `spawn('toktx', ...)` esperando binários no PATH global (hoje `blender` e `toktx` não estão instalados/no PATH; `gltf-transform` está apenas em `game/node_modules/.bin/`).
   - Regexes de presets (linhas 82–96, ex.: `/palette.png$/`, `/terrain\/terrain.png$/`, `/career\/.+png$/`) usam `/` literal e **falham no Windows** porque `glob` / `path.join` produzem `\`, fazendo texturas críticas (`terrain.png`, `career/*.png`, `palette.png`) caírem no preset `etc1s` lossy errado.
   - Dispara todos os processos `spawn` simultaneamente em loop `for` sem limite de concorrência.
   - Tudo será corrigido na `T0.3`.
6. **Dependência visual de servidor WebSocket (`Server.js`):**
   - Com `VITE_SERVER_URL=` vazio, `CookieArea` nunca inicializa o contador 3D (`this.counter.init()` só dispara em `server.connected`), `AltarArea` fica preso em `"..."` e nunca dispara cataclismo, `CircuitArea` bloqueia salvamento de recordes, e a UI exibe banners vermelhos `"Server currently offline"`. Resolvido integralmente na `T0.2`.

### 0.3 Inventário verificado de texturas, dimensões e canais (`game/static/`)
| Caminho em `game/static/` | Dimensão real | Formato / Canais | Preset KTX2 (`compress.js`) | Papel no motor |
|---|---|---|---|---|
| `palette.png` | `128 × 4` | PNG RGB (3) | `uastc --genmipmap srgb RGB` | Swatches globais de cor (`NearestFilter`) |
| `terrain/terrain.png` | `512 × 512` | PNG RGBA (4) | `uastc --genmipmap linear RGB` | `R`=lajes, `G`=grama/sombra, `B`=profundidade água |
| `career/careerHetic.png` | `316 × 60` | PNG RGBA (4) | `uastc srgb RG` | Bloco `refLine` (`R`=texto emissivo, `G`=contorno) |
| `career/careerUzik.png` | `168 × 60` | PNG RGBA (4) | `uastc srgb RG` | Bloco `refLine.001` |
| `career/careerImmersiveGarden.png` | `340 × 60` | PNG RGBA (4) | `uastc srgb RG` | Bloco `refLine.002` |
| `career/careerOnlineTeacher.png` | `332 × 92` | PNG RGBA (4) | `uastc srgb RG` | Bloco `refLine.003` |
| `career/careerFreelancer.png` | `240 × 60` | PNG RGBA (4) | `uastc srgb RG` | Bloco `refLine.004` |
| `career/careerIRLTeacher.png` | `268 × 92` | PNG RGBA (4) | `uastc srgb RG` | Bloco `refLine.005` |
| `projects/images/*.png` (31 arq.) | `960 × 540` | PNG RGBA (4) | `etc1s --qlevel 255 srgb RGB` | Slides de projetos na tela principal (`ProjectsArea`) |
| `lab/images/*.png` (14 full) | `960 × 540` | PNG RGBA (4) | `etc1s --qlevel 255 srgb RGB` | Preview grande na esteira do `LabArea` |
| `lab/images/*-mini.png` (14 mini) | `240 × 136` | PNG RGBA (4) | `etc1s --qlevel 255 srgb RGB` | Miniaturas nos cartões pendurados na corrente (`LabArea`) |
| `timeMachine/timeMachineScreenFolio.png` | `140 × 124` | PNG RGBA (4) | `etc1s --qlevel 255 srgb RGB` | Tela 1 da TV CRT (`NearestFilter`, scanlines) |
| `timeMachine/timeMachineScreenMGS.png` | `140 × 124` | PNG RGBA (4) | `etc1s --qlevel 255 srgb RGB` | Tela 2 da TV CRT (alterna ao colidir com a TV) |
| `areas/satanStar.png` | `128 × 128` | PNG RGB (3) | `etc1s linear R --swizzle r001` | Desenho no chão do `AltarArea` (canal `R`) |
| `intro/*Label.png` (4 arq.) | `256 × 128` | PNG RGBA (4) | `etc1s linear R --swizzle r001` | Dica inicial no chão/ar (teclado, toque, Xbox, PS) |
| `ui/map/map-day.png` & `map-night.png` | `1024 × 1024` | PNG RGBA → `.webp` | WebP (`sharp`, q=80) | Fundo do modal de Mapa interativo |
| `ui/previews/*.png` (8 arq.) | `600 × 600` | PNG RGBA → `.webp` | WebP (`sharp`, q=80) | Ilustração esquerda de cada aba do Menu |
| `social/share-image.png` | `1200 × 630` | PNG RGBA (4) | N/A (servido direto) | Preview de compartilhamento (OpenGraph / Twitter) |

### 0.4 Materiais embutidos em `static/areas/areas.glb` (27 materiais verificados)
- **Compartilhados / Emissivos (9):** `palette`, `darkGray`, `redGradient`, `emissiveOrangeRadialGradient`, `emissivePurpleRadialGradient`, `emissiveBlueRadialGradient`, `emissiveWhiteRadialGradient`, `emissiveGreenRadialGradient`, `waterfall`.
- **Com textura/identidade específica de área (18):**
  - `Landing`: `stylizedMap` (mapa no quiosque)
  - `Career`: `careerTextHetic`, `careerTextUzik`, `careerTextImmersive`, `careerTextOnlineTeacher`, `careerTextFreelancer`, `careerTextIRLTeacher` (sobrescritos em runtime por `CareerArea.js`)
  - `Projects`: `projectsCarpet`, `projectsLabels`, `blackboardLabels`
  - `Lab`: `labCarpet` (e `blackboardLabels`)
  - `Cookie`: `cookieBanner`
  - `Bowling`: `bowlingLabelStrike`
  - `Circuit`: `circuitBrand` *(marca legada — substituir!)*, `circuitWebgl`, `circuitWebgpu`, `circuitThreejs`, `airDancer`

### 0.5 Inventário de conteúdo real de Victor Neves (`D:\GitHub\_kit-clones\timeline\index.html`)
- **Identidade:** Victor Neves (`@voaneves`), Especialista em Transformação Digital · `https://voaneves.com/#contato` · `github.com/voaneves` · `linkedin.com/in/voaneves` · `youtube.com/c/voaneves`.
- **15 marcos em 5 zonas:**
  1. **Origens (1994–2011):** `1994-09` Nasci em Araguaína/TO · `2005-01` Fiz o meu primeiro blog, Ponto Interativo · `2011-12` Terminei o ensino médio.
  2. **UNICAMP (2012–2014):** `2012-01` Entrei na UNICAMP · `2012-07` Comecei a desenvolver sites para ONGs · `2012-12` Minha iniciação científica em nanotubos de titânio · `2014-07` Entrei na empresa Jr. MTE, na UNICAMP.
  3. **Indústria (2017–2019):** `2017-01` Comecei a trabalhar na Coca-Cola FEMSA · `2018-07` Viajei para a Alemanha para um estágio na KRONES/AG · `2019-01` Virei Trainee na Coca-Cola FEMSA.
  4. **Dados (2019–2021):** `2019-10` Voltei pro Tocantins e comecei a trabalhar no Damásio · `2021-06` Aprofundei meus conhecimentos em Ciências de Dados na IBM.
  5. **Transformação digital (2022–hoje):** `2022-01` Comecei a desenvolver sites e criar apps profissionalmente · `2022-09` Virei ALI do SEBRAE · `2022-09` Casei com o amor da minha vida.
- **6 projetos open-source:** `dtcg-contrast`, `xbox-sales`, `snake-arena`, `Meu Poupig`, `js-games`, `Financial Sample Analysis`.

---

## 1. Princípios, Fronteira de Adaptação e Regra de Ouro de Assets

### 1.1 O que mantemos do motor atual em `game/`
1. **Arquitetura e Game Loop:** `Game.js`, `Ticker.js`, `Objects.js`, `References.js`, `Zones.js`, `InstancedGroup.js`, `InteractivePoints.js`.
2. **Locomoção e Física do Veículo:** `PhysicsVehicle.js`, `Player.js`, `VisualVehicle.js` — dirigir o carrinho com suspensão, boost, pulo, trilhas e física em tudo já é divertido nos primeiros 3 segundos.
3. **Motor Gráfico WebGPU + TSL:** `Rendering.js`, `MeshDefaultMaterial.js`, `WaterSurface.js`, `Fog.js`, `DayCycles.js`, `YearCycles.js`, `Weather.js`, `Reveal.js`.
4. **Os Mini-games:** `CircuitArea`, `BowlingArea`, `CookieArea`, `AltarArea`, `ToiletArea` e brinquedos físicos globais (`Bricks`, `Fences`, `Benches`, `Lanterns`, `ExplosiveCrates`).
5. **Acessibilidade multi-dispositivo já pronta:** teclado/mouse, toque mobile (`Nipple` + `InteractiveButtons`) e gamepad Xbox/PlayStation.

### 1.2 O que sai 100%
- Todo nome, bio, URL, e-mail, rede social, projeto, experimento, conquista pessoal e easter egg placeholder/legado da base anterior.
- Todos os modelos pessoais legados (letras físicas antigas em `landing`; `baguira`, `sudo`, `boy` e `statue` em `social`; banner `circuitBrand` no `circuit`).
- Todo conteúdo promocional ou sazonal legado (`BlackFriday`, `Easter`, `Christmas`, modal comunitário do Discord, URL externa antiga na `TimeMachineArea`).
- Script de Google Analytics (`G-JMSN30BQ5J`) e alertas vermelhos de servidor offline.

### 1.3 Regra de Ouro para Assets (Especialmente Mini-games)
> **"Os assets devem ser cuidadosamente alterados e, se não combinar, devemos manter. Principalmente para os mini-games."**

Critérios objetivos aplicados a qualquer asset antes de aceitar uma troca:
1. **Paridade de linguagem formal:** o novo asset precisa ter bevel, proporção "chunky" e densidade de polígonos compatíveis com os objetos vizinhos da cena.
2. **Paridade de sombreamento:** usar o material `palette` (UV no swatch correto) ou shader `MeshDefaultMaterial` para reagir identicamente aos 4 ciclos de dia, light bounce, neblina e reveal.
3. **Paridade física nos mini-games:** em `CircuitArea`, `BowlingArea`, `CookieArea`, `ToiletArea` e `Vehicle`, **não alterar geometria de colisão nem proporção funcional**; alterar apenas texturas de branding/UI ou cores de shader quando combinarem 100%.
4. **Regra de rollback imediato:** ao testar um asset alterado em `npm run dev` (dia + pôr do sol + noite), se ele parecer "colado", inferior ou fora do estilo, **reverter imediatamente** e manter o original.

---

## 2. Direção Criativa e "Spin Próprio" (*Roadtrip Costeira Tátil*)

### 2.1 Conceito: *Roadtrip Costeira Tátil*
Em vez de manter a paleta roxo-magenta + outono laranja atual ou forçar a paleta da marca pessoal (`#f4ead4` / `#f50000`) com regionalismo exagerado, criamos uma **ilha costeira luminosa, tátil e vibrante** percorrida de carro como uma *roadtrip* editorial com desvios lúdicos:
- **Sensação de dia:** sol claro e limpo, grama verde-fresca, água turquesa translúcida com espuma branca nítida, areia dourada suave e sombras azul-cobalto limpas — visual tátil, colorido e alegre de diorama-brinquedo à beira-mar.
- **Sensação de pôr do sol e noite:** golden hour coral-âmbar cinematográfica evoluindo para uma noite azul-marinho limpa onde postes, lanternas, faróis, o portal estrelado e as pedras emissivas da linha do tempo brilham com alto contraste.
- **Sensação de percurso:** em vez de áreas espalhadas sem ordem narrativa, a ilha ganha uma **rota cênica principal** ligando a história do Victor em loop, com os mini-games em penínsulas/bolsões laterais.

### 2.2 Pilares de design que guiam o spin próprio no motor
| Pilar Criativo | Características buscadas | Onde e como implementamos em `game/` |
|---|---|---|
| **Costa Viva em WebGPU/TSL** | Oceano turquesa luminoso, gradiente nítido de raso→fundo, espuma recortada na praia e luz solar limpa | `Terrain.js` (gradiente areia → turquesa → azul profundo), `WaterSurface.js` (espuma de praia `shoreEdge`, `ripples` mais limpos) e `DayCycles.js` (luz solar clara + sombra azul-cobalto). |
| **Estética Tátil de Brinquedo** | Cores alegres de alta legibilidade, formas macias/arredondadas, contraste limpo e surpresas físicas divertidas | Curadoria de swatches em `palette.png` (removendo cinzas/roxos pesados), flores/árvores vibrantes (`World.js`, `Flowers.js`), pinturas alegres no veículo (`VisualVehicle.js`) e feedback elástico nos interativos. |
| **Terreno & Vegetação Orgânicos** | Lâminas de grama em leque com variação natural, transição suave entre lajes/areia/grama e horizonte rico (mantendo mapa finito 192×192 m) | Nova implementação de `Grass.js` sobre `terrainNode` + `Tracks.js` (tufos multi-lâmina inclináveis pelo vento e pelas rodas), ajuste de `Floor.js` e borda costeira orgânica na Fase 5. |
| **Exploração Leve e Acolhedora** | Mundo compacto cheio de charme, sinalização amigável e recompensas constantes de curiosidade | Pins com status "visitado" no `Map.js`, micro-notificações de descoberta de zona, trilhas claras no chão (`terrain.png`) guiando o olhar sem poluir o HUD. |
| **Narrativa de Roadtrip Dirigível** | Sequência clara de paradas com ritmo visual e câmeras cinematográficas nos pontos de destaque | Layout de anel narrativo na Fase 5 (`Landing → Career → Social → Lab → Projects`) + preservação e polimento das câmeras cinematográficas em `ProjectsArea` e `LabArea`. |
| **Mini-games Rejogáveis & Legíveis** | Alta clareza isométrica de pistas/alvos e loops curtos de pontuação que prendem o jogador offline | `CircuitArea` turbinado com medalhas **Ouro / Prata / Bronze**, Top 5 local persistente, delta de recorde e celebração no pódio; loops locais completos em `Bowling`, `Cookie` e `Altar`. |

### 2.3 Bíblia Visual — Parâmetros Exatos de Cor, Luz e Shaders

#### A. Presets completos de `sources/Game/Cycles/DayCycles.js`
Todos os 4 keyframes calibrados (ajustáveis em tempo real pelo painel `#debug → 🕜 Day Cycles`):

```js
const presets = {
    day: {
        revealColor: new THREE.Color('#2ad4d9'),
        revealIntensity: 10,
        electricField: 0,
        temperature: 14,
        lightColor: new THREE.Color('#fff3db'),
        lightIntensity: 1.25,
        shadowColor: new THREE.Color('#3d6cb9'),
        fogColorA: new THREE.Color('#68e1fd'),
        fogColorB: new THREE.Color('#a8d4ff'),
        fogNearRatio: 0.34,
        fogFarRatio: 1.28
    },
    dusk: {
        revealColor: new THREE.Color('#ff9a62'),
        revealIntensity: 6.0,
        electricField: 0.2,
        temperature: 8,
        lightColor: new THREE.Color('#ffaa6b'),
        lightIntensity: 1.22,
        shadowColor: new THREE.Color('#4a3a8c'),
        fogColorA: new THREE.Color('#ff9d6c'),
        fogColorB: new THREE.Color('#5b6ce6'),
        fogNearRatio: 0.05,
        fogFarRatio: 1.25
    },
    night: {
        revealColor: new THREE.Color('#45d9ff'),
        revealIntensity: 9.0,
        electricField: 0.85,
        temperature: 0,
        lightColor: new THREE.Color('#4b73ff'),
        lightIntensity: 3.1,
        shadowColor: new THREE.Color('#1d2a78'),
        fogColorA: new THREE.Color('#0f2454'),
        fogColorB: new THREE.Color('#1e3a6e'),
        fogNearRatio: -0.75,
        fogFarRatio: 1.05
    },
    dawn: {
        revealColor: new THREE.Color('#ffd08a'),
        revealIntensity: 5.5,
        electricField: 0.2,
        temperature: 6,
        lightColor: new THREE.Color('#ffc599'),
        lightIntensity: 1.2,
        shadowColor: new THREE.Color('#6d4c8f'),
        fogColorA: new THREE.Color('#ffd1a6'),
        fogColorB: new THREE.Color('#87c6ff'),
        fogNearRatio: 0.3,
        fogFarRatio: 1.25
    },
}
```
- **Nota sobre temperatura e neve/gelo:** `temperature` foi ajustada de `5 / -7.5` para `14 / 0` na média de verão/primavera, mantendo neve e gelo possíveis quando `YearCycles` passa pelo inverno (ou via `#debug`), sem deixar a ilha costeira congelada o tempo todo.
- **Light bounce (`Ligthing.js` l. 89):** trocar `this.bounceColor = uniform(color('#82487f'))` por `uniform(color('#5a8c7a'))` para eliminar o reflexo roxo por baixo dos objetos.

#### B. Terreno, Lajes, Água e Vegetação
| Arquivo | Parâmetro / Uniform | Atual | Novo Alvo (*Roadtrip Costeira*) |
|---|---|---|---|
| `Terrain.js` l. 46 | `colors[0]` (areia/borda) | `stop: 0.1, '#ffa94e'` | `stop: 0.08, '#f4d38c'` (areia quente clara) |
| `Terrain.js` l. 47 | `colors[1]` (água rasa) | `stop: 0.3, '#5bc2b9'` | `stop: 0.28, '#34cfc4'` (turquesa translúcido) |
| `Terrain.js` l. 48 | `colors[2]` (água funda) | `stop: 0.9, '#13375f'` | `stop: 0.85, '#12487a'` (azul oceano vivo) |
| `Terrain.js` l. 85 | `grassColorUniform` | `'#b8b62e'` | `'#76c442'` (verde-prado vibrante) |
| `Floor.js` l. 47 | `slabHighColor` | `'#ffcf8b'` | `'#f7e5c2'` (pedra clara de estrada) |
| `Floor.js` l. 48 | `slabLowColor` | `'#a87762'` | `'#b3957a'` (rejunte natural quente) |
| `WaterSurface.js` l. 226 | `shoreEdge` | `0.17` | `0.16` (espuma de praia mais refinada) |
| `World.js` l. 69 | `birchTrees` (copa) | `'#ff4f2b'`, `'#ff903f'` | `'#2fa866'`, `'#6cd464'` (verde-esmeralda vivo) |
| `World.js` l. 70 | `oakTrees` (copa) | `'#b4b536'`, `'#d8cf3b'` | `'#f2b705'`, `'#ffe066'` (dourado solar alegre) |
| `World.js` l. 71 | `cherryTrees` (copa) | `'#ff6d6d'`, `'#ff9990'` | `'#ff6f91'`, `'#ffb3c6'` (coral/rosa suave) |

#### C. Especificação Técnica da Nova `Grass.js` (Correção `T0.0` + Polimento `T2.2`)
Como o `Grass.js` atual está quebrado (importando `TerrainHeight.js`), vamos estruturá-lo corretamente sobre o motor em `game/`:
- **Posicionamento em janela deslizante ao redor da câmera (`view.optimalArea.position`):** exatamente como `Floor.js` e `WaterSurface.js` fazem, mantendo um grid de instâncias centralizado no `optimalArea` com snap por célula (`cellSize`), cobrindo toda a área visível sem precisar de centenas de milhares de instâncias fixas para os 192×192 m.
- **Amostragem direta de `this.game.terrain.terrainNode(worldXZ)` na GPU (TSL):**
  - `terrainData.g` controla a escala vertical da lâmina (`0` fora de áreas de grama ou onde o pneu do carro acabou de passar via `Tracks.js`, e `1` em gramado cheio). Assim, **zero lâminas flutuam na água, nas estradas ou em áreas pavimentadas**, automaticamente, mesmo quando mudarmos `terrain.png` na Fase 5.
  - `terrainData.b` abaixa/descarta qualquer lâmina perto da água (`step(0.08, terrainData.b)`).
- **Acabamento visual orgânico:**
  - Cada instância é um tufo curvado de 2–3 lâminas afiladas (2 segmentos no Q1 mobile, 3 segmentos no Q0 desktop).
  - Gradiente vertical por `uv().y`: base `#468c2e` → meio `#76c442` → ponta ensolarada `#b7eb5d`.
  - Balanço orgânico guiado por `this.game.wind.direction`, `this.game.wind.strength` e ruído `this.game.noises.perlin`.
  - Material `MeshDefaultMaterial` (`hasCoreShadows: true`, `hasDropShadows: true`, `hasFog: true`, `hasReveal: true`, `hasWater: false`) para casar 100% com a iluminação dos 4 ciclos de dia.

#### D. Pinturas do Veículo (`VisualVehicle.js` + Recompensas de Conquistas)
Mantemos as 6 chaves `data-name` (evitando quebrar CSS/HTML/storage existentes) e atualizamos as cores e rótulos exibidos:

| Chave (`data-name`) | Nome PT-BR / EN | Material / Gradiente (`VisualVehicle.js` + `Materials.js`) | Critério de desbloqueio |
|---|---|---|---|
| `red` *(padrão)* | **Coral Solar** / *Solar Coral* | `redGradient`: `#ff5a36` → `#d92b4b` | Padrão (0 conquistas) |
| `orange` | **Turquesa Costa** / *Coastal Teal* | `orangeGradient`: `#1dd3c6` → `#0d6e9e` | 20% das conquistas |
| `white` | **Areia Pérola** / *Pearl Sand* | `whiteGradient`: `#fffaf0` → `#d4cfc4` | 40% das conquistas |
| `black` | **Grafite Noturno** / *Midnight Slate* | `blackGradient`: `#4a5568` → `#1a202c` | 60% das conquistas |
| `flames` | **Chamas Solares** / *Solar Flames* | Shader Voronoi existente com `colorA: '#ffd166'`, `colorB: '#ff4d2e'` | 80% das conquistas |
| `abyssal` | **Cósmico** / *Cosmic* | Shader estrelado existente com `fresnelColor: '#2ae8ff'` | 100% das conquistas |

#### E. Política de edição da `static/palette.png` (`128 × 4` PNG)
- `palette.png` é lida com `NearestFilter` e usada por quase todas as malhas da ilha.
- **Protocolo seguro (`T2.3`):**
  1. Salvar cópia intacta em `game/resources/palette-original.png`.
  2. Gerar uma tabela/mapa de swatches usados (lendo os pixels de `128×4` via script Node) antes de editar.
  3. Fazer ajustes cirúrgicos de saturação/luminosidade apenas nos swatches excessivamente escuros/roxos, **sem anti-aliasing** e preservando as posições exatas `(x, y)` de cada swatch.
  4. Validar visualmente todas as 12 áreas; qualquer swatch que prejudicar um mini-game é revertido imediatamente.

### 2.4 Storyboard dos Primeiros 15 Segundos
| Tempo | O que o visitante vê e ouve | Estado técnico |
|---|---|---|
| `0.0–1.8 s` | Tela limpa com anel luminoso turquesa (`revealColor`) acompanhando o progresso real do `ResourcesLoader` + dica de controle adaptada ao dispositivo + botão de som clicável. | Lote 0 carregado; lote 1 + Rapier WASM em paralelo. |
| `1.8–3.2 s` | Onda radial `Reveal` se expande a partir do carro no `LandingArea`; ilha costeira solar revelada; música ambiente entra suave (se som ativo). | `World.step(1)` concluído; `PreRenderer` executado em Q0 WebGPU. |
| `3.2–7.0 s` | Primeiro acelero: carro avança, derruba as letras físicas `VICTOR NEVES` com som de impacto (`hitBrick`), deixa marcas na grama (`Tracks.js`) e ativa partículas. | Controle 100% livre; conquista `landingLeave` ao sair da praça. |
| `7.0–15.0 s` | Estrada de pedra clara guia o jogador direto para a `CareerArea` (onde a 1ª pedra da linha do tempo sobe com som de pedra + display de ano 7-segmentos) ou para o `ProjectsArea` / mini-games logo ao lado. | Descoberta guiada sem pop-ups invasivos. |

---

## 3. Jogabilidade, Física do Veículo, Câmera, Controles e Modo Offline-First

### 3.1 Parâmetros do Veículo (`PhysicsVehicle.js`) e Câmera (`View.js`)
- **Manter os valores base de `PhysicsVehicle.js`** (já testados e afinados para o terreno de 192×192 m, rampas do Circuito e obstáculos):
  - `steeringAmplitude = 0.5`, `engineForceAmplitude = 300`, `boostMultiplier = 2`, `topSpeed = 5`, `topSpeedBoost = 40`, `brakeAmplitude = 35`, `idleBrake = 0.06`, `reverseBrake = 0.4`.
  - Suspensão: `low = 0.88` (stiffness `20`), `mid = 1.23` (`30`), `high = 1.63` (`40`).
- **Manter `View.js`** com `idealRatio = 1920 / 1080`, `focusPoint` suavizado, `cinematic` para `ProjectsArea` e `LabArea`, e câmera livre em `#debug` + tecla `V`.
- **Única melhoria planejada de câmera (opcional na Fase 3):** suavizar a transição de saída do modo cinemático se houver salto perceptível em telas ultrawide ou retrato mobile.

### 3.2 Controles (Mapeamento Completo — PT-BR e EN)
| Ação | Teclado / Mouse | Toque (Mobile / Tablet) | Gamepad (Xbox / PlayStation) |
|---|---|---|---|
| Dirigir | `WASD` ou `SETAS` | Arrastar com 1 dedo (`Nipple`) | `RT/R2` acelerar · `LT/L2` ré · Analógico Esq. virar |
| Boost | `SHIFT` | Arrasto máximo / botão | `B` / Círculo |
| Freio | `CTRL ESQ.` ou `B` | — | `X` / Quadrado |
| Pulo | `ESPAÇO` | Toque sobre o carro | `Y` / Triângulo |
| Interagir / Abrir | `ENTER` | Botão contextual `Interagir` | `A` / Cruz |
| Mapa | `M` | Botão de Mapa no canto superior | `M` / Menu |
| Som (Mudo) | `L` | Botão em Opções / ícone inicial | — |
| Respawn / Desatolar | `R` | Botão contextual `Desatolar` | `Select` |
| Suspensão Hidráulica | Teclas numéricas `1–9` | — | `LB / RB` (`L1 / R1`) |
| Buzina | `H` | — | Pressionar Analógico Esq. |
| Mover Câmera / Zoom | Arrastar botão esquerdo + Scroll | 2 dedos mover / pinça | Analógico Dir. + clique zoom |

### 3.3 Especificação Técnica do Modo Standalone / Offline-First (`T0.2`)

Como `VITE_SERVER_URL` fica vazio no GitHub Pages, o modo **Standalone** passa a ser cidadão de primeira classe (não um "erro de servidor offline").

#### A. Detecção e classes CSS (`Server.js` + `general.styl`)
```js
// Em Server.js
this.isStandalone = !import.meta.env.VITE_SERVER_URL
if (this.isStandalone) {
    document.documentElement.classList.add('is-standalone')
}
```
- **Regras CSS quando `html.is-standalone` está ativo:**
  - Oculta `.offline-element` (avisos vermelhos `"Server currently offline"` em `circuit-content`, `circuit-end` e `whispers-content`).
  - Oculta `.js-navigation-item[data-name="whispers"]` (aba Whispers do Menu).
  - Oculta a linha `tr.is-server-row` na tabela de `Options`.
  - Exibe `.standalone-element` (ex.: nota sutil `"Modo local · Recordes salvos neste navegador"` na aba Circuito).

#### B. Contratos de `localStorage` (Schemas JSON versionados)
| Chave `localStorage` | Schema JSON | Usado em | Limpeza / Reset |
|---|---|---|---|
| `vn_lang` | `"pt-BR"` ou `"en"` | `I18n.js`, `Options.js` | Mantido no reset de conquistas |
| `vn_circuit_scores_v1` | `Array<{ tag: string, flag: string, timeMs: number, medal: 'gold'\|'silver'\|'bronze'\|'none', at: string }>` (máx. 5 itens ordenados por `timeMs` crescente) | `CircuitArea.js` | Botão opcional `"Limpar recordes"` na aba Circuito |
| `vn_cookies_count_v1` | `number` (inteiro ≥ 0; sincronizado com `document.cookie` se existir valor maior) | `CookieArea.js` | Mantido entre sessões |
| `vn_altar_count_v1` | `number` (inteiro ≥ 0) | `AltarArea.js` | Mantido entre sessões |
| `achievements` | Schema nativo de `Achievements.js` (`{ [groupName]: number \| string[] }`) | `Achievements.js` | Botão `"Resetar conquistas"` |

#### C. Comportamento exato de cada área no Modo Standalone
1. **`CircuitArea.js`:**
   - Ao cruzar a linha de chegada (`finish()`), calcula `medal`:
     - `timeMs < 28000` → `'gold'` (Ouro)
     - `timeMs < 34000` → `'silver'` (Prata)
     - `timeMs < 42000` → `'bronze'` (Bronze)
     - caso contrário → `'none'`
   - Compara `timeMs` com `vn_circuit_scores_v1`: se houver menos de 5 recordes ou se bater o 5º colocado, **libera o formulário de iniciais (3 letras) + bandeira** mesmo sem servidor.
   - Ao enviar o formulário, salva em `vn_circuit_scores_v1`, re-renderiza a tabela na aba `Circuit` e no placar 3D da pista, dispara `achievements.setProgress('circuitLeaderboard', 1)` e solta confete no pódio se for novo #1.
2. **`CookieArea.js`:**
   - No construtor (`setCounter`), se `this.game.server.isStandalone`, carrega `this.counter.value` de `vn_cookies_count_v1` e chama `this.counter.init()` imediatamente (fazendo a placa 3D de contagem aparecer sempre).
   - A cada `accept()`, incrementa `this.counter.value`, atualiza a placa 3D e salva em `vn_cookies_count_v1`.
3. **`AltarArea.js`:**
   - Se `this.game.server.isStandalone`, carrega `this.value` de `vn_altar_count_v1`, chama `this.updateText(this.value)` e calcula `this.progressUniform.value = (this.value % 5) / 5`.
   - A cada entrada na zona (`setDeathZone`), soma `+1`, persiste em `vn_altar_count_v1`, atualiza `progressUniform` e, quando `this.value % 5 === 0`, dispara o efeito de **Cataclismo** (relâmpagos/tempestade/efeito climático + conquista `cataclysm`).
4. **`Whispers.js`:**
   - Quando `this.game.server.isStandalone`, não registra atalho `Keyboard.KeyT` para abrir modal de whispers e não instancia flames de servidor, economizando recursos.

---

## 4. Mapeamento Cirúrgico das 14 Áreas e Level Design (Atual vs Novo Layout)

### 4.1 Mapa Espacial Atual (`192 × 192 m`, coordenadas reais de `areas.glb` e `respawnsReferences.glb`)
```text
                        Norte (-Z = -96)
    (-54.5, -67.4)
    [TimeMachine]
                                      (28.9, -21.8)         (75.3, -27.9)
                                        [Social]               [Altar]
                                           |
                                      (25.8, -0.9)     (52.5, -12.0)
                                        [Career]       [BehindTheScene]
         (-17.7, 7.1)                      |
          [Circuit]                (35.8, 13.4)             (70.6, 9.9)
                                    [Projects]             [Achievements]
                          (13.1, 17.7)     |
                             [Lab]         |
                                           |
                          (12.3, 35.3) (49.2, 38.5)
                            [Cookie]    [Landing]  <-- Spawn: (39.5, 37.8)
                                           |
                    (2.3, 68.9)            |              (66.9, 66.7)
                    [Bowling]              |                [Toilet]
                        Sul (+Z = +96)
```

### 4.2 Tabela Resumo das 14 Áreas em `sources/Game/World/Areas/`
| # | Arquivo | Decisão | Nome PT-BR / EN | Posição atual `(X, Z)` | Respawn atual `(X, Z)` | Fase principal de edição |
|---|---|---|---|---|---|---|
| 1 | `LandingArea.js` | **Manter e Rebrandar** | Início / Welcome | `(49.25, 38.52)` | `(39.53, 37.83)` | F1 (prompts), F4 (letras `VICTOR NEVES`), F5 (layout) |
| 2 | `CareerArea.js` | **Manter mecânica + Novo conteúdo** | Carreira / Timeline | `(25.84, -0.90)` | `(26.28, 9.63)` | F1 (6 texturas RG + anos), F5 (layout) |
| 3 | `ProjectsArea.js` | **Manter mecânica + Novo conteúdo** | Projetos / Projects | `(35.76, 13.41)` | `(35.78, 17.57)` | F0 (`.png`/`.ktx`), F1 (6 projetos), F5 (layout) |
| 4 | `LabArea.js` | **Manter e Repropositar** | Lab & Dados / Lab | `(13.14, 17.68)` | `(17.88, 18.80)` | F0 (`.png`/`.ktx`), F1 (6 labs), F5 (layout) |
| 5 | `SocialArea.js` | **Manter + Limpar figuras legadas** | Contato / Contact | `(28.90, -21.82)` | `(25.67, -14.47)` | F1 (links + ocultar mascotes), F4 (totem), F5 (layout) |
| 6 | `TimeMachineArea.js` | **Manter e Repropositar** | Arquivo 2005 / 2D Archive | `(-54.53, -67.40)` | `(-56.49, -64.74)` | F1 (link 2D + 2 telas CRT `140×124`), F5 (layout) |
| 7 | `BehindTheSceneArea.js` | **Manter e Reescrever** | Bastidores / Behind the Scene | `(52.46, -11.96)` | `(48.82, -11.47)` | F1 (texto técnico), F2 (`bloomColor`), F5 (layout) |
| 8 | `AchievementsArea.js` | **Manter 100% 3D + Novas metas** | Conquistas / Achievements | `(70.55, 9.94)` | `(70.00, 20.36)` | F1 (37 conquistas), F2 (água herda `Terrain`), F5 (layout) |
| 9 | `CircuitArea.js` | **Manter Mini-game (Prioritário)** | Circuito / Circuit | `(-17.74, 7.07)` | `(-13.71, 14.70)` | F0 (offline), F2 (`circuitBrand`), F3 (medalhas/Top 5) |
| 10 | `BowlingArea.js` | **Manter 100% Mini-game** | Boliche / Bowling | `(2.31, 68.91)` | `(21.30, 62.22)` | F1 (prompts i18n), F3 (polimento) |
| 11 | `CookieArea.js` | **Manter 100% Mini-game** | Cookies / Cookie Stand | `(12.25, 35.25)` | `(15.64, 36.38)` | F0 (contador offline), F1 (prompt i18n) |
| 12 | `AltarArea.js` | **Manter com leve re-tema** | Portal do Caos / Vortex | `(75.34, -27.95)` | `(74.79, -14.08)` | F0 (cataclismo offline), F2 (trocar `satanStar.png`) |
| 13 | `ToiletArea.js` | **Manter 100% Easter egg** | *(oculto no mapa)* | `(66.88, 66.74)` | `(70.91, 66.02)` | Preservar intacto |
| 14 | `EasterArea.js` (+ `BlackFriday` / `Christmas`) | **Remover** | *(fora do escopo)* | — | — | F0 (`T0.1`: limpar imports, código morto e estilos) |

### 4.3 Fichas Cirúrgicas das Áreas Principais

#### Área 1 — `LandingArea.js` (*Início*)
- **Nós verificados:** `refLettersPhysicalDynamic.010..019` (`mass: 0.2`), `refKioskInteractivePoint`, `refControlsInteractivePoint`, `refBonfireInteractivePoint`, `refBonfireHashes`, `refBonfireBurn.001`, `gamepadPhysicalDynamic.001`, `phonePhysicalDynamic.001`, `gizmoPhysicalDynamic`.
- **Som / Conquista:** `hitBrick` nas letras; `campfire` ao acender a fogueira (via `Res(e)t`); conquista `areas: 'landing'` (`boundingIn`) e `landingLeave` (`boundingOut`).
- **Alterações planejadas:**
  - `T1.2`: traduzir os 3 prompts (`Mapa`, `Controles`, `Resetar`).
  - `T4.1`: substituir as 10 letras legadas no `timeline-world.blend` por `VICTOR NEVES` (11 letras individuais `refLettersPhysicalDynamic.001..011`, `mass: 0.2`, cada uma com `cuboid*`, material `palette` mutado).
  - `T5.2`: atualizar textura do material `stylizedMap` no quiosque com o novo mapa da ilha.

#### Área 2 — `CareerArea.js` (*Carreira / Timeline*)
- **Nós verificados e `extras` em `areas.glb`:**
  - `refLine` (`size: 4`, `hasEnd: true`, `color: 'blue'`, `texture: 'careerHetic'`)
  - `refLine.001` (`size: 2`, `hasEnd: true`, `color: 'orange'`, `texture: 'careerUzik'`)
  - `refLine.002` (`size: 2`, `hasEnd: true`, `color: 'orange'`, `texture: 'careerImmersiveGarden'`)
  - `refLine.003` (`size: 6`, `hasEnd: false`, `color: 'purple'`, `texture: 'careerOnlineTeacher'`)
  - `refLine.004` (`size: 14`, `hasEnd: false`, `color: 'orange'`, `texture: 'careerFreelancer'`)
  - `refLine.005` (`size: 9`, `hasEnd: true`, `color: 'purple'`, `texture: 'careerIRLTeacher'`)
  - `refYear` (4 meshes `digit*` com shader de 7 segmentos usando `DataTexture(7, 10)`).
- **Mecânica de shader (`CareerArea.js` l. 106–122):**
  - Revela progressivamente da esquerda para a direita via `step(baseUv.x, line.labelReveal)`.
  - `alpha = step(0.1, max(textureColor.r, textureColor.g))`.
  - `finalColor = mix(color('#251f2b'), emissiveColor, textureColor.r)` — ou seja, **canal `R` = texto emissivo colorido, canal `G` = borda/sombra escura legível sobre a pedra**.
- **Alterações planejadas (`T1.4`):**
  - Substituir os 6 PNGs em `static/career/` via `scripts/generate-career-textures.mjs` mantendo compatibilidade imediata com os nomes de `userData.texture` do `areas.glb` atual.
  - Atualizar paleta das linhas: `blue: '#3b9eff'`, `orange: '#ff8a3d'`, `purple: '#34cfc4'`, `green: '#7ed957'`.
  - Atualizar `this.year` para percorrer os anos reais da trajetória de Victor (`1994` → `2026` por tabela de marcos indexada por `offsetTarget / this.year.size`, ver Decisão `D5`).

#### Área 3 — `ProjectsArea.js` (*Projetos*)
- **Nós verificados:** `refImages`, `refTitle`, `refUrl`, `refAttributes` (`role`, `at`, `with`), `refDistinctions`, `refPagination`, `refPrevious`, `refNext`, `refBlackBoard.002`, `refAnvilPhysicalDynamic`, `grinderPhysicalDynamic`, `blowerPhysicalDynamic`, `quenchPhysicalDynamic.001`.
- **Alterações planejadas:**
  - `T0.3`: fazer `this.images.getResourceAndLoad` respeitar `VITE_COMPRESSED` (usando `texture` + `.png` em dev e `textureKtx` + `.ktx` em prod, tirando a extensão fixa de `projects.js` ou trocando `.ktx` ↔ `.png` automaticamente).
  - `T1.3`: trocar `sources/data/projects.js` e `static/projects/images/*` pelos 6 projetos de Victor Neves; manter `distinctions: []` (ocultando medalhas legadas).
  - `T2.3` (opcional): substituir textura do material `projectsLabels` em runtime para trocar rótulos `ROLE / AT / WITH` por `STACK / TIPO / FOCO` caso faça mais sentido que manter os rótulos originais.

#### Área 4 — `LabArea.js` (*Lab & Dados*)
- **Nós verificados:** `refMecanism`, `refChainLeft`, `refChainRight`, `refChainPulley`, `refGearA/B/C`, `refImages.001`, `refMini`, `cauldronPhysicalDynamic`, `blackBoardPhysicalDynamic.001`.
- **Alterações planejadas:**
  - `T0.3`: respeitar `VITE_COMPRESSED` ao carregar `image` e `imageMini`.
  - `T1.5`: popular `sources/data/lab.js` com 6 experimentos/demos reais do Victor e 12 imagens (`6 × 960×540` + `6 × 240×136`). Preservar 100% da geometria de oficina/roldana/caldeirão.

#### Área 5 — `SocialArea.js` (*Contato & Redes*)
- **Nós verificados em `areas.glb`:** `baguiraPhysicalDynamic`, `sudoPhysicalDynamic`, `boyPhysicalDynamic`, `refStatuePhysicalDynamic`, `gitHubPhysicalDynamic`, `linkedInPhysicalDynamic`, `youtubePhysicalDynamic`, `mailPhysicalDynamic`, `xPhysicalDynamic`, `blueskyPhysicalDynamic.001`, `discordPhysicalDynamic`, `twitchPhysicalDynamic`, `onlyfansPhysicalDynamic`, `refCenter`, `refFan`, `refOnlyFans`.
- **Alterações planejadas:**
  - `T1.1` (Camada 1 — código):
    - Reescrever `sources/data/social.js` (6 links de Victor Neves + modal `contact`).
    - Criar helper em `SocialArea.js` para ocultar visualmente (`visible = false`) e desabilitar corpos físicos (`body.setEnabled(false)`) dos nós de personagens legados (`baguira`, `sudo`, `boy`) e placas de redes não usadas (`twitch`, `bluesky`, `discord`), garantindo que o jogador nunca esbarre em colisores invisíveis nem veja figuras estranhas já a partir da Fase 1.
  - `T4.2` (Camada 3 — Blender): remover esses nós definitivamente de `areas.glb` e trocar `refStatuePhysicalDynamic` por um totem/escultura estilizada neutra (mantendo a conquista `statueDown`).

#### Área 6 — `TimeMachineArea.js` (*Arquivo 2005 / Versão 2D*)
- **Nós verificados:** `refInteractivePoint.006`, `refTvPhysicalDynamic` (contém `refScreen`), `cupPhysicalDynamic*`, `stoolPhysicalDynamic.004`.
- **Alterações planejadas (`T1.5`):**
  - Substituir a URL externa antiga pelo link da versão 2D da timeline (`https://voaneves.github.io/timeline/#carreira`, e na Fase 6 `../#carreira` quando hospedado dentro do mesmo site).
  - Substituir `static/timeMachine/timeMachineScreenFolio.png` (`140×124`) por tela retrô do blog **Ponto Interativo (2005)** e `timeMachineScreenMGS.png` (`140×124`) por tela retrô da **Timeline 2D** — mantendo o som de alerta + shader de scanlines quando o carro bate na TV.

#### Área 7 — `BehindTheSceneArea.js` (*Bastidores*)
- **Nós verificados:** `refCenter.001` (portal estrelado procedural), `refInteractivePoint.004`, `lightGeneratorPhysicalDynamic*`, `refObjectsPhysicalDynamic*`.
- **Alterações planejadas:**
  - `T1.1`: reescrever texto completo do menu `behindTheScene` em `sources/index.html` e `consoleLog.js`.
  - `T2.1`: ajustar `this.bloomColor` de `#6053ff` para `#2ad4d9` (ciano luminoso combinando com o novo esquema).

#### Área 8 — `AchievementsArea.js` (*Conquistas*)
- **Nós verificados:** `refPillar`, `refWaterfallDrop`, `refWaterfallStill`, `refWaterfallParticles`, `refWaterfallZone`, `refInteractivePoint.005`.
- **Alterações planejadas:** preservar 100% dos assets 3D e shaders (a cachoeira herda automaticamente as novas cores turquesa/oceano de `Terrain.js` l. 39–40). Atualizar lista e metas em `sources/data/achievements.js` (`T1.5`).

#### Áreas 9 a 13 — Mini-games e Easter Eggs (`Circuit`, `Bowling`, `Cookie`, `Altar`, `Toilet`)
- **`CircuitArea.js`:** preservar 100% da pista, rampas, checkpoints (`refCheckpoints.000..007`), obstáculos cinemáticos (`refObstaclesPhysicalKinematicPositionBased.001..005`), air dancers e física. Trocar apenas `circuitBrand` (textura em runtime na `T2.3` e no `.blend` na `T4.2`) + adicionar Top 5 local (`T0.2`) e medalhas Ouro/Prata/Bronze (`T3.1`).
- **`BowlingArea.js`:** preservar 100% da pista, 10 pinos (`refPinPositions`), bola, barreiras (`refBumpers`), sofás, bar e jukebox. Traduzir apenas prompts interativos (`T1.2`).
- **`CookieArea.js`:** preservar 100% do quiosque, forno, chaminé, fole, banner e 22 cookies instanciados. Ativar placa 3D de contagem offline via `localStorage` (`T0.2`) e traduzir prompt (`T1.2`).
- **`AltarArea.js`:** preservar feixe cilíndrico, partículas, glifos flutuantes e sinos. Ativar contador + cataclismo offline a cada 5 sacrifícios (`T0.2`) e substituir `static/areas/satanStar.png` (`128×128`) por glifo geométrico/vórtice (`T2.3`).
- **`ToiletArea.js`:** preservar 100% da cabine derrubável, banquinho, papéis e lua noturna.

---

### 4.4 Proposta de Novo Layout da Fase (Fase 5 — *Spin Próprio "Roadtrip Costeira"*)

Diagrama espacial da ilha reorganizada (dentro dos mesmos `192 × 192 m`, de `-96` a `+96`):

```text
                        Norte (-Z = -96) — Costa Aberta
             (-52, -62)                                (48, -56)
           [TimeMachine]                             [BehindTheScene]
           (Ilhota Retrô)                           (Mirante Estrelado)
                                 (0, -48)
                                [Social / Contato]  <-- Praça Final com vista pro mar
                                /        \
                  (-34, -22)   /          \   (40, -18)
                   [Lab]  ----+            +---- [Altar / Vortex]
                     |                                (Ponta Leste)
                     |
           (-48, 12) |         ANEL PRINCIPAL            (58, 12)
          [Circuit]  |        (Estrada de Pedra)       [Achievements]
         (Península) |            /      \               (Cachoeira)
                     |     (-16, 14)    (24, 10)
                     +---- [Projects]  [Career] ----+
                              \          /          |
                               \        /           |
                                (0, 42)             | (54, 48)
                               [Landing]            +-[Toilet]
                            Spawn: (0, 50)
                                /      \
                   (-32, 62)   /        \   (28, 60)
                   [Bowling]             [Cookie]
                        Sul (+Z = +96) — Praia Sul
```

#### Tabela de Coordenadas Propostas para a Fase 5 (`T5.1`)
| Área | Novo Centro `(X, Z)` | Novo Respawn `(X, Z)` | Papel no fluxo de navegação |
|---|---|---|---|
| `landing` | `(0, 42)` | `(0, 50)` olhando `-Z` | Entrada central ao Sul; nome `VICTOR NEVES` logo à frente; visão direta da bifurcação do anel |
| `career` | `(24, 10)` | `(24, 22)` | Braço Leste do anel principal — conduz cronologicamente de Sul para Norte (`1994 → 2026`) |
| `social` | `(0, -48)` | `(0, -36)` | Clímax ao Norte com vista aberta para o oceano; praça de contato e redes |
| `lab` | `(-34, -22)` | `(-24, -20)` | Braço Noroeste do retorno — experimentos interativos & dados |
| `projects` | `(-16, 14)` | `(-14, 22)` | Braço Oeste fechando o loop de volta ao `Landing` — galeria dos 6 projetos |
| `circuit` | `(-48, 12)` | `(-44, 20)` | Península Oeste dedicada para corrida sem conflito espacial com áreas narrativas |
| `bowling` | `(-32, 62)` | `(-20, 58)` | Bolsão Sudoeste — acesso rápido do spawn para diversão imediata |
| `cookie` | `(28, 60)` | `(22, 56)` | Bolsão Sudeste — acesso rápido à direita do spawn |
| `achievements` | `(58, 12)` | `(52, 20)` | Costa Leste — cachoeira desaguando diretamente no oceano turquesa |
| `altar` | `(40, -18)` | `(36, -10)` | Ponta Nordeste entre `Career` e `BehindTheScene` |
| `behindTheScene` | `(48, -56)` | `(42, -48)` | Mirante estrelado no extremo Nordeste |
| `timeMachine` | `(-52, -62)` | `(-46, -56)` | Ilhota retrô a Noroeste acessível por faixa rasa de areia |
| `toilet` | `(54, 48)` | `(50, 46)` | Cantinho escondido no Sudeste entre árvores |

**Regras de pintura do novo `terrain.png` (`512×512` RGBA):**
- **Canal `R` (Lajes):** traçar o anel principal largo (`~7–9 m`) ligando `Landing → Career → Social → Lab → Projects → Landing` e ramais mais estreitos (`~4–5 m`) até cada mini-game.
- **Canal `G` (Grama):** preencher os canteiros internos e bordas verdes com borda suave (`blur 2–3 px`), deixando `0` nas estradas, praias e sob pisos pavimentados (`Bowling`, `Circuit`, `Projects`, `Lab`).
- **Canal `B` (Água/Profundidade):** moldar o recorte costeiro de ilha orgânica ao redor do raio útil (~78–86 m), com enseada rasa ligando a ilhota da `TimeMachine`, mantendo correspondência 1:1 com o heightfield de `terrain.glb`.

---

## 5. Especificação Completa de Conteúdo (Victor Neves) e I18n

### 5.1 Arquitetura Bilíngue (`sources/data/i18n.js` + `sources/Game/I18n.js`)
- **Idioma padrão:** `pt-BR`. Persistência em `localStorage.getItem('vn_lang')`.
- **API mínima de `I18n.js`:**
  - `this.lang` (`'pt-BR'` | `'en'`)
  - `t(key, params)` retorna string traduzida com interpolação `{valor}`
  - `applyToDOM()` percorre `[data-i18n]` (via `textContent`) e `[data-i18n-html]` (via `innerHTML`, apenas strings internas confiáveis)
  - `toggle()` alterna `'pt-BR'` ↔ `'en'`, salva em `localStorage`, chama `applyToDOM()` e dispara `this.events.trigger('change', [ this.lang ])` para atualizar prompts de `InteractivePoints`, `Map.js` e `Achievements.js`.

#### Tabela de Copy Principal (`PT-BR` e `EN`)
| Chave `i18n` | Português (`pt-BR` — padrão) | Inglês (`en`) |
|---|---|---|
| `home.title` | `Victor Neves` | `Victor Neves` |
| `home.p1` | `Bem-vindo!` | `Welcome!` |
| `home.p2` | `Sou <strong>Victor Neves</strong> — engenheiro, desenvolvedor e especialista em <strong>dados e transformação digital</strong>.` | `I'm <strong>Victor Neves</strong> — engineer, developer and specialist in <strong>data & digital transformation</strong>.` |
| `home.p3` | `Dirija pela ilha para explorar minha linha do tempo, projetos open-source, experimentos e mini-games.` | `Drive around the island to explore my timeline, open-source projects, experiments and mini-games.` |
| `home.p4` | `E fique à vontade para derrubar algumas coisas pelo caminho!` | `And feel free to knock a few things over along the way!` |
| `options.title` | `Opções` | `Options` |
| `options.language` | `Idioma` | `Language` |
| `options.audio` | `Áudio` | `Audio` |
| `options.quality` | `Qualidade` | `Quality` |
| `options.quality.high` | `Alta` | `High` |
| `options.quality.low` | `Baixa` | `Low` |
| `options.stuck` | `Atolou?` | `I'm stuck!` |
| `options.respawn` | `Reposicionar` | `Respawn` |
| `options.reset` | `Resetar mundo` | `Reset world` |
| `options.renderer` | `Renderizador` | `Renderer` |
| `contact.title` | `Vamos conversar` | `Let's talk` |
| `contact.lead` | `Quer tirar uma ideia do papel, melhorar um processo ou falar de dados e transformação digital?` | `Want to bring an idea to life, improve a process, or talk about data and digital transformation?` |
| `contact.direct.title` | `Contato direto` | `Direct contact` |
| `contact.direct.cta` | `Falar com Victor` | `Message Victor` |
| `contact.social.title` | `Redes e código` | `Socials & code` |
| `circuit.standalone` | `Modo local · Top 5 salvo neste navegador` | `Local mode · Top 5 saved in this browser` |
| `circuit.noScore` | `Nenhum tempo registrado ainda` | `No lap time recorded yet` |
| `circuit.restart` | `Reiniciar` | `Restart` |
| `circuit.end` | `Encerrar` | `End` |
| `circuit.controls` | `Controles` | `Controls` |
| `prompt.map` | `Mapa` | `Map` |
| `prompt.controls` | `Controles` | `Controls` |
| `prompt.reset` | `Resetar` | `Res(e)t` |
| `prompt.projects` | `Projetos` | `Projects` |
| `prompt.lab` | `Lab & Dados` | `Lab & Data` |
| `prompt.cookie` | `Aceitar cookie` | `Accept cookie` |
| `prompt.circuit` | `Iniciar corrida` | `Start race` |
| `prompt.behindTheScene` | `Bastidores` | `Behind the scene` |
| `prompt.achievements` | `Conquistas` | `Achievements` |
| `prompt.timeMachine` | `Versão 2D · 2005` | `2D Archive · 2005` |

### 5.2 Carreira / Timeline (`CareerArea.js` + `scripts/generate-career-textures.mjs`)

#### Mapeamento dos 6 Blocos
| Slot `areas.glb` | Arquivo em `static/career/` | Dimensão exata | Cor | Linha 1 (Título) | Linha 2 (Subtítulo / Período) |
|---|---|---|---|---|---|
| `refLine` | `careerHetic.png` | `316 × 60` | `blue` | `ORIGENS · ARAGUAÍNA/TO` | `1994–2011 · Blog Ponto Interativo` |
| `refLine.001` | `careerUzik.png` | `168 × 60` | `orange` | `UNICAMP` | `2012–2016 · ONGs · IC · Jr. MTE` |
| `refLine.002` | `careerImmersiveGarden.png` | `340 × 60` | `orange` | `COCA-COLA FEMSA & KRONES` | `2017–2019 · Alemanha · Trainee` |
| `refLine.005` | `careerIRLTeacher.png` | `268 × 92` | `purple` | `DAMÁSIO & DADOS` | `2019–2021 · IBM Data Science` |
| `refLine.003` | `careerOnlineTeacher.png` | `332 × 92` | `purple` | `APPS, WEB & SEBRAE` | `2022–2024 · ALI · Casamento` |
| `refLine.004` | `careerFreelancer.png` | `240 × 60` | `green` | `TRANSFORMAÇÃO DIGITAL` | `2022–HOJE · Produtos & Open Source` |

#### Especificação do Gerador `game/scripts/generate-career-textures.mjs`
Para garantir 100% de compatibilidade com o shader TSL de `CareerArea.js` (linhas 112–121) sem depender de editor de imagem manual:
1. Recebe o array com os 6 registros (arquivo, largura `W`, altura `H`, linha 1, linha 2).
2. Monta um SVG exatamente em `W × H` com fundo `#000000`:
   - Primeiro renderiza o texto com `stroke="#00ff00"` (`stroke-width` proporcional à altura, `stroke-linejoin="round"`) e `fill="#00ff00"` — isso popula o **canal `G`** (contorno/sombra `#251f2b`).
   - Por cima, renderiza o mesmo texto com `fill="#ff0000"` (`stroke="none"`) — isso popula o **canal `R`** (texto emissivo brilhante na cor da faixa).
3. Converte cada SVG para PNG RGBA via `sharp(Buffer.from(svg)).png().toFile(...)` direto em `game/static/career/<arquivo>.png`.
4. **Atenção ao `flipY = false`:** `Game.js` l. 166–171 carrega as texturas de carreira com `resource.flipY = false`. Verificar na primeira execução se o texto fica na orientação correta; se aparecer invertido verticalmente, adicionar `.flip()` no `sharp` dentro do gerador.

#### Curva do Display de Anos 7-Segmentos (`CareerArea.js` l. 368)
Em vez de `2008 + Math.floor(offsetTarget)`, usar uma tabela de marcos reais indexada pela fração `t = clamp(this.year.offsetTarget / this.year.size, 0, 1)`:
```js
const yearTimeline = [1994, 2005, 2011, 2012, 2014, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026]
const idx = Math.min(yearTimeline.length - 1, Math.floor(t * yearTimeline.length))
const yearCurrent = yearTimeline[idx]
```
Assim, dirigir pelo corredor percorre de `1994` (nascimento) até `2026` (presente), sincronizado com os 6 blocos.

### 5.3 Projetos (`sources/data/projects.js` — 6 Projetos Reais)
Cada projeto tem 2–3 imagens `960 × 540` em `static/projects/images/` (capturadas diretamente dos demos publicados em `voaneves.github.io/<repo>` ou geradas em alta nitidez com cards visuais dos dashboards/ferramentas):

```js
export default [
    {
        title: 'dtcg-contrast',
        titleSmall: [ 'dtcg', 'contrast' ],
        url: 'https://voaneves.github.io/dtcg-contrast/',
        attributes: {
            role: [ 'Creator', 'JavaScript' ],
            at: 'Open Source',
            with: [ 'WCAG · APCA', 'OKLCH Tokens' ]
        },
        distinctions: [],
        images: [ 'dtcg-contrast-1', 'dtcg-contrast-2', 'dtcg-contrast-3' ]
    },
    {
        title: 'snake-arena',
        titleSmall: [ 'snake', 'arena' ],
        url: 'https://voaneves.github.io/snake-arena/',
        attributes: {
            role: [ 'Python', 'PyTorch · DQN' ],
            at: 'RL Benchmark',
            with: [ 'Reinforcement', 'Learning' ]
        },
        distinctions: [],
        images: [ 'snake-arena-1', 'snake-arena-2', 'snake-arena-3' ]
    },
    {
        title: 'Meu Poupig',
        titleSmall: [ 'Meu', 'Poupig' ],
        url: 'https://voaneves.github.io/meupoupig/',
        attributes: {
            role: [ 'HTML · CSS', 'JavaScript' ],
            at: 'EdTech Game',
            with: [ 'Educação', 'Financeira' ]
        },
        distinctions: [],
        images: [ 'meu-poupig-1', 'meu-poupig-2', 'meu-poupig-3' ]
    },
    {
        title: 'js-games',
        titleSmall: [ 'js', 'games' ],
        url: 'https://voaneves.github.io/js-games/',
        attributes: {
            role: [ 'Vanilla JS', 'PWA' ],
            at: 'Open Source',
            with: [ '4 Jogos Clássicos', 'Zero Frameworks' ]
        },
        distinctions: [],
        images: [ 'js-games-1', 'js-games-2', 'js-games-3' ]
    },
    {
        title: 'xbox-sales',
        titleSmall: [ 'xbox', 'sales' ],
        url: 'https://voaneves.github.io/xbox-sales/',
        attributes: {
            role: [ 'Excel', 'VBA' ],
            at: 'Dashboard BI',
            with: [ 'CSV em 1 Clique' ]
        },
        distinctions: [],
        images: [ 'xbox-sales-1', 'xbox-sales-2' ]
    },
    {
        title: 'Financial Sample',
        titleSmall: [ 'Financial', 'Analysis' ],
        url: 'https://voaneves.github.io/financial_sample_analysis/',
        attributes: {
            role: [ 'Power BI', 'Data Analysis' ],
            at: 'Analytics',
            with: [ 'Dataset Microsoft' ]
        },
        distinctions: [],
        images: [ 'financial-sample-1', 'financial-sample-2' ]
    }
]
```
*(Nomes-base sem extensão `.ktx`/`.png`: `ProjectsArea.js` anexa `.${ext}` automaticamente conforme `VITE_COMPRESSED`.)*

### 5.4 Lab & Experimentos (`sources/data/lab.js` — 6 Itens Reais)
Cada item usa `image` (`960 × 540`) e `imageMini` (`240 × 136`) sem extensão fixa:
1. `DTCG Contrast · OKLCH` → `https://voaneves.github.io/dtcg-contrast/` (`lab-dtcg`, `lab-dtcg-mini`)
2. `Snake Arena · DQN` → `https://voaneves.github.io/snake-arena/` (`lab-snake-dqn`, `lab-snake-dqn-mini`)
3. `JS Games · PWA` → `https://voaneves.github.io/js-games/` (`lab-js-games`, `lab-js-games-mini`)
4. `Meu Poupig · Finanças` → `https://voaneves.github.io/meupoupig/` (`lab-poupig`, `lab-poupig-mini`)
5. `Timeline 2D Acessível` → `https://voaneves.github.io/timeline/#carreira` (`lab-timeline-2d`, `lab-timeline-2d-mini`)
6. `Código Aberto · GitHub` → `https://github.com/voaneves` (`lab-github`, `lab-github-mini`)

### 5.5 Social & Contato (`sources/data/social.js` + Modal `contact`)
```js
export default [
    { name: 'Contato', modal: 'contact', align: 'right' },
    { name: 'Site', url: 'https://voaneves.com/#contato', align: 'right' },
    { name: 'GitHub', url: 'https://github.com/voaneves', align: 'right' },
    { name: 'LinkedIn', url: 'https://linkedin.com/in/voaneves', align: 'right' },
    { name: 'YouTube', url: 'https://youtube.com/c/voaneves', align: 'left' },
    { name: 'Timeline 2D', url: 'https://voaneves.github.io/timeline/', align: 'left' },
]
```
- **Modal `contact` (substitui `discord` em `sources/index.html`):**
  - Título: **Vamos conversar** (`Let's talk`)
  - Bloco 1 — **Contato direto:** *"Quer tirar uma ideia do papel, melhorar um processo ou falar de dados e transformação digital?"* → botão `Falar com Victor` (`https://voaneves.com/#contato`).
  - Bloco 2 — **Redes & Código:** *"Acompanhe projetos abertos, estudos de dados e trajetória profissional."* → botões `LinkedIn` (`https://linkedin.com/in/voaneves`) e `GitHub` (`https://github.com/voaneves`).

### 5.6 Conquistas (`sources/data/achievements.js` — 37 Conquistas Offline-First)
Todas calibradas para funcionar 100% sem servidor (`areas = 12`, `whisper` omitida no modo standalone, `circuitLeaderboard` ligada ao Top 5 local, `cataclysm` disparado a cada 5 entradas no Portal):

| # | Grupo | Título PT-BR | Descrição PT-BR | Meta | Único |
|---|---|---|---|---|---|
| 1 | `landingLeave` | Pé na estrada! | Saia da área inicial. | `1` | — |
| 2 | `areas` | Explorador da Ilha | Visite todas as **12** áreas da ilha. | `12` | `true` |
| 3 | `projects` | Portfólio Completo | Veja todos os projetos na área **Projetos**. | `projectsData.length` | `true` |
| 4 | `lab` | Cientista de Dados | Veja todos os itens na área **Lab & Dados**. | `labData.length` | `true` |
| 5 | `cookie` | Primeiro Cookie | Aceite **1** cookie. | `1` | — |
| 6 | `cookie` | Massa Pronta | Aceite **10** cookies. | `10` | — |
| 7 | `cookie` | Fornada Cheia | Aceite **100** cookies. | `100` | — |
| 8 | `cookie` | Mestre dos Cookies | Aceite **1000** cookies. | `1000` | — |
| 9 | `sea` | Mergulho Costeiro | Entre no mar. | `1` | — |
| 10 | `upsideDown` | Tartaruga | Capote o carro de cabeça para baixo. | `1` | — |
| 11 | `frontFlip` | Mortal de Frente | Faça um front flip e caia nas 4 rodas. | `1` | — |
| 12 | `backFlip` | Salto de Fé | Faça um back flip e caia nas 4 rodas. | `1` | — |
| 13 | `suspensions` | Lowrider | Use a suspensão hidráulica do carro. | `4` | — |
| 14 | `honk` | Bi-bi! | Buzine 10 vezes pela ilha. | `10` | — |
| 15 | `explosiveCrates` | Demolição Total | Exploda todos os caixotes explosivos. | `20` | `true` |
| 16 | `goHigh` | Rumo às Nuvens | Alcance **15 metros** de altura. | `15` | — |
| 17 | `strike` | Strike Perfeito! | Faça um strike no boliche. | `1` | — |
| 18 | `toiletDown` | Não Perturbe | Derrube a cabine escondida. | `1` | — |
| 19 | `circuitFinish` | Bandeira Quadriculada | Complete uma volta no Circuito. | `1` | — |
| 20 | `circuitFinishFast` | Piloto de Ouro | Complete o Circuito em menos de **28s**. | `1` | — |
| 21 | `circuitLeaderboard` | Novo Recorde! | Registre seu tempo no Top 5 local. | `1` | — |
| 22 | `fullDay` | Do Amanhecer à Noite | Passe um ciclo completo de dia na ilha. | `1` | — |
| 23 | `distanceDriven` | Primeira Volta | Dirija **1 km**. | `1` | — |
| 24 | `distanceDriven` | Roadtrip | Dirija **10 km**. | `10` | — |
| 25 | `distanceDriven` | Volta ao Mundo | Dirija **100 km**. | `100` | — |
| 26 | `sacrifice` | Oferenda ao Vórtice | Entre no feixe do Portal do Caos. | `1` | — |
| 27 | `cataclysm` | Testemunha do Caos | Presencie um cataclismo (5 entradas no Portal). | `1` | — |
| 28 | `weatherSnow` | Dia de Neve | Presencie neve na ilha. | `1` | — |
| 29 | `weatherRain` | Chuva na Estrada | Presencie chuva na ilha. | `1` | — |
| 30 | `lightning` | 1.21 Gigawatts! | Seja atingido por um raio. | `1` | — |
| 31 | `waterfall` | Instinto Gamer | O que você esperava atrás da cachoeira? Um tesouro? | `1` | — |
| 32 | `fan` | Fã Número 1 | Invoque um ventilador na área Social. | `1` | — |
| 33 | `reset` | Tudo no Lugar | Resete todos os objetos do mundo. | `1` | — |
| 34 | `statueDown` | Revolução! | Derrube o monumento na área Social. | `1` | — |
| 35 | `konami` | Cima, Cima, Baixo, Baixo… | Você conhece o resto. | `1` | — |
| 36 | `debug` | Modo Engenheiro | Acesse o painel `#debug`. | `1` | — |
| 37 | `hacker` | Hacker | Esta conquista não pode ser alcançada. | `1` | — |

### 5.7 Bastidores (`behindTheScene-content`) e `sources/data/consoleLog.js`
- **Bastidores (HTML):**
  - **Sobre esta experiência:** portfólio e linha do tempo interativa de Victor Neves (`github.com/voaneves/timeline`), com versão 2D acessível sempre disponível.
  - **Stack Técnica:** Three.js (`THREE.REVISION`) + WebGPU / TSL, física Rapier3D, áudio Howler.js, animações GSAP e build Vite.
  - **Modo Debug:** adicione `#debug` ao final da URL e pressione `[V]` para câmera livre.
- **`consoleLog.js`:**
  - Substituir a arte ASCII atual por `VICTOR NEVES · TIMELINE`.
  - Trocar cor dos pipes de `#D66FFF` (roxo) para `#2AD4D9` (turquesa-costeiro).
  - Listar apenas links reais de Victor Neves (`voaneves.com`, `github.com/voaneves`, `linkedin.com/in/voaneves`, `youtube.com/c/voaneves`) e dicas de `#debug` / `[V]`.

---

## 6. Pipeline de Assets (`.glb` / `.ktx` / `.png` / `compress.js`) e Convenções Blender

### 6.1 Fluxo em 3 Camadas (Do Zero-Risco ao Blender)
```text
[Camada 1: Código + Shaders TSL + Dados]   --> preview imediato via `npm run dev`
         |
         v
[Camada 2: Texturas 2D (.png via scripts)] --> preview imediato com VITE_COMPRESSED=""
         |
         v
[Camada 3: Blender (timeline-world.blend)] --> export .glb sem compressão -> verify-glb.mjs -> preview
         |
         v
[Produção: `npm run compress` (Draco + KTX2 + WebP)] --> `VITE_COMPRESSED=1 npm run build`
```

### 6.2 Especificação da Reforma de `game/scripts/compress.js` (`T0.3`)
Reescrever `scripts/compress.js` mantendo exatamente os mesmos formatos de saída (`-compressed.glb`, `.ktx`, `.webp`) porém robusto no Windows:
1. **Resolução de binários:**
   - `gltf-transform`: resolver via `path.resolve('node_modules/.bin/gltf-transform' + (process.platform === 'win32' ? '.cmd' : ''))` (zero dependência global).
   - `toktx`: verificar disponibilidade com `spawnSync('toktx', ['--version'])`; se ausente, imprimir instrução objetiva de instalação do KTX-Software e pular apenas a geração `.ktx`, concluindo Draco e WebP normalmente.
2. **Normalização de caminhos:** converter `const normalized = inputFile.replaceAll('\\', '/')` antes de testar os regexes de presets (`palette.png`, `terrain/terrain.png`, `career/*.png`, `areas/satanStar.png`, `intro/*.png`, etc.) — evita corromper `palette.ktx` e `terrain.ktx` no Windows.
3. **Fila de concorrência (`MAX_CONCURRENCY = 4`):** substituir disparos paralelos ilimitados por um worker pool assíncrono simples com resumo final (`OK / Skipped / Failed`).
4. **Escopo seletivo por CLI:** `node scripts/compress.js static/projects` comprime apenas a pasta passada, mantendo `npm run compress` (`static/`) para compressão completa.
5. **Preservação dos parâmetros Draco e KTX2:**
   - GLB: `etc1s --quality 255` seguido de `draco --method edgebreaker --quantization-volume mesh --quantize-position 12 --quantize-normal 6 --quantize-texcoord 6 --quantize-color 2 --quantize-generic 2`.
   - `palette.png`: `--nowarn --2d --t2 --encode uastc --genmipmap --assign_oetf srgb --target_type RGB`.
   - `terrain/terrain.png`: `--nowarn --2d --t2 --encode uastc --genmipmap --assign_oetf linear --target_type RGB`.
   - `career/*.png`: `--nowarn --2d --t2 --encode uastc --assign_oetf srgb --target_type RG`.
   - `ui/**/*.{png,jpg}`: `sharp(input).webp({ quality: 80 })`.

### 6.3 Script Validador de Contrato `.glb` (`game/scripts/verify-glb.mjs` — `T4.0`)
Antes de aceitar qualquer exportação do Blender nas Fases 4 e 5, rodar `node scripts/verify-glb.mjs` que lê o JSON embutido em `static/areas/areas.glb` e `static/respawns/respawnsReferences.glb` e verifica automaticamente:
1. Todos os 13 grupos de área ativos existem (`landing`, `career`, `projects`, `lab`, `social`, `timeMachine`, `behindTheScene`, `achievements`, `circuit`, `bowling`, `cookie`, `altar`, `toilet`).
2. Todos os `ref*` críticos de cada área continuam presentes (ex.: `refLettersPhysicalDynamic*`, `refLine*` ×6, `refYear`, `refImages`, `refCheckpoints.000..007`, `refPinPositions`, `refStart`, `refCenter`, `refZoneBounding*`, `refZoneFrustum*`).
3. Nenhum nó legado indesejado restou após a Fase 4 (`baguira*`, `sudo*`, `boy*`).
4. Todos os `respawn*` referenciados por `Map.js` existem em `respawnsReferences.glb`.
5. O material `palette` está presente e sem textura base64 gigante embutida por engano.

### 6.4 Procedimento Operacional no Blender (Fases 4 e 5)
1. Duplicar o arquivo `.blend` base em `game/resources/` para `game/resources/timeline-world.blend` (nunca sobrescrever o arquivo original).
2. Antes de qualquer exportação `.glb`:
   - Conferir escala aplicada (`Ctrl+A → Scale`) nos objetos novos ou editados.
   - Conferir pivô e hierarquia dentro da coleção correta da área (`landing`, `social`, `circuit`, etc.).
   - No Shader Editor do material `palette`, **mutar (`M`)** o nó `Image Texture` da paleta (o Three.js injeta `paletteTexture` em runtime).
   - Exportar em `File → Export → glTF 2.0 (.glb)` com **Custom Properties ativado** (`Include → Data → Custom Properties`), **Compression (Draco) DESMARCADO**, **+Y Up ativado**.
3. Rodar `node scripts/verify-glb.mjs` → abrir `npm run dev` → testar colisões e visual em Dia/Noite.

---

## 7. Arquitetura Técnica, Performance e Integração com o Site Raiz

### 7.1 Orçamento de Performance e Peso
| Métrica | Alvo Desktop (`Quality.level = 0`) | Alvo Mobile (`Quality.level = 1`) | Ferramenta de medição |
|---|---|---|---|
| Frame rate estável dirigindo | ≥ 60 fps | ≥ 30–60 fps | `#debug#stats` / DevTools Performance |
| Draw calls por frame | ≤ 180 | ≤ 140 | `#debug#stats` (`renderer.info.render.drawCalls`) |
| Shadow map | `2048 × 2048` | `512 × 512` | `Ligthing.js` l. 23 |
| Pós-processamento | `cheapDOF` + `bloom` (5 mips) | `bloom` (2 mips), sem DOF | `Rendering.js` l. 82–99 |
| Água | `hashBlur` (25 repeats) | Sem blur (`baseOutput`) | `WaterSurface.js` l. 330–343 |
| Economia imediata de `dist/` | **−136 MB** ao mover `.wav` em `T0.1` | Idem | Tamanho de `game/dist/` |
| Erros de console / HTTP 404 | **0** | **0** | DevTools Console + Network |

### 7.2 Estratégia de Integração com `D:\GitHub\_kit-clones\timeline` (Fase 6 — `T6.3`)
- **Durante Fases 0 a 5:** o site raiz (`index.html`, `src/`, `assets/`) não sofre nenhuma alteração. Todo desenvolvimento acontece isolado em `game/` com preview em `npm run dev` / `npm run preview`.
- **Na Fase 6 (somente após aprovação do dono):**
  - Publicar a saída de `game/dist/` na rota `play/` (ou `3d/`) do repositório raiz (ou via workflow GitHub Actions de build do `game/`).
  - Atualizar o botão `"Jogar em 3D"` / `"Press start"` no `index.html` raiz para apontar para `./play/`, preservando 100% da página 2D acessível com **Lighthouse 100×4**.
  - Garantir que o link da `TimeMachineArea` e um atalho no Menu do jogo apontem de volta para `../#carreira` (versão acessível/texto completo).

---

## 8. Gates de Qualidade, Verificação Automatizada e Playtest

| Gate | Onde ocorre | Verificações objetivas obrigatórias |
|---|---|---|
| **G0 — Fundação Limpa** | Após `T0.3` | `Grass.js` funcionando sobre `terrainNode` + `Tracks`; `npm run build` passa com código 0; `dist/sounds/musics/` sem `.wav`; 0 chamadas a `googletagmanager.com`; 0 avisos `"Server currently offline"`; troca de um `.png` em `projects/images/` aparece direto em `npm run dev`. |
| **G1 — Conteúdo 100% Victor** | Após `T1.5` | Busca case-insensitive em `game/sources/` por nomes, links ou projetos legados retorna **0 ocorrências** de conteúdo antigo na UI, dados ou links (mantendo apenas chaves técnicas internas de `.glb` até a Fase 4). Toggle `PT-BR ↔ EN` funciona sem reload. |
| **G2 — Spin Visual Validado** | Após `T2.3` | Inspeção visual em `#debug` nos 4 períodos (`day`, `dusk`, `night`, `dawn`) + chuva e neve; água turquesa com espuma limpa; grama verde-fresca dobrando sob as rodas; textos de Carreira, Projetos, Lab e UI legíveis em todos os horários; `circuitBrand` e `Altar` atualizados. |
| **G3 — Mini-games & Gameplay** | Após `T3.2` | Completar 2 corridas no Circuito (medalha + Top 5 persistido após F5); fazer strike e reset no Boliche; aceitar 10 cookies (contador 3D persistido após F5); entrar 5 vezes no Portal do Caos (cataclismo offline + conquista); testar teclado, mouse, toque (DevTools mobile `390×844`) e gamepad. |
| **G4 — Assets 3D Coesos** | Após `T4.2` | `node scripts/verify-glb.mjs` passa sem erros; `VICTOR NEVES` derruba com física/som; figuras legadas removidas de `Social`; mini-games 100% preservados sem regressão. |
| **G5 — Novo Layout & Mapa** | Após `T5.2` | Percorrer todo o anel narrativo `Landing → Career → Social → Lab → Projects → Landing`; testar teleporte de cada um dos 12 pins do novo Mapa (Dia e Noite); confirmar 0 objetos flutuando e 0 colisores fantasmas. |
| **G6 — Pronto para Publicar** | Após `T6.2` | `VITE_COMPRESSED=1 npm run build` + `npm run preview` com 0 erros 404; WebGPU (`Q0`), WebGL2 fallback e Mobile (`Q1`) validados; FPS estável. |

---

## 9. Roadmap Granular com Tarefas Numeradas (`T0.0` a `T6.3`)

> **Fluxo padrão de entrega de cada tarefa:** editar arquivos do escopo → validar build (`npm.cmd run build`) → abrir preview local (`npm.cmd run dev`) e inspecionar visualmente → confirmar o DoD da tarefa antes de passar para a próxima.

---

### Fase 0 — Recuperação, Higiene, Modo Offline-First e Pipeline

#### `T0.0` — Restaurar e corrigir `Grass.js` (Bloqueador Imediato)
- **Pré-requisito:** nenhum.
- **Arquivos:** `game/sources/Game/World/Grass.js`
- **Passos:**
  1. Remover o arquivo antigo (que importa `./TerrainHeight.js` inexistente).
  2. Implementar `Grass.js` em TSL integrado ao `this.game.terrain.terrainNode(positionWorld.xz)` (usando canal `G` já afetado por `this.game.tracks` e canal `B` para evitar água) com grid deslizante centralizado em `this.game.view.optimalArea.position`, vento (`this.game.wind`) e densidade escalada por `this.game.quality.level`.
  3. Validar no browser que o carro amassa a grama ao dirigir e que nenhuma lâmina nasce dentro da água ou em estradas.
- **Validação:** `npm.cmd run build` + `npm.cmd run dev`.
- **DoD:** build verde com 0 erros de módulo; grama renderizada, responsiva às rodas e ao vento, em 60 fps.

#### `T0.1` — Limpeza de Analytics, Metadados, Código Promocional e `.wav` Duplicados
- **Pré-requisito:** `T0.0`.
- **Arquivos:** `game/sources/index.html`, `game/package.json`, `game/sources/Game/Title.js`, `game/sources/Game/World/Areas/Areas.js`, `game/sources/style/index.styl`, `game/sources/Game/BlackFriday/`, `game/sources/Game/Easter.js`, `game/sources/Game/World/Areas/EasterArea.js`, `game/sources/style/blackFriday.styl`, `game/sources/style/easter.styl`, `game/static/sounds/musics/*.wav`
- **Passos:**
  1. Remover `<script>` do Google Analytics (`G-JMSN30BQ5J`) em `sources/index.html` (linhas 44–52).
  2. Atualizar `<html lang="pt-BR">`, `<title>`, `<meta name="description">`, `og:*`, `twitter:*` e `apple-mobile-web-app-title` para **Victor Neves — Linha do Tempo & Portfólio 3D**.
  3. Atualizar `"name": "victor-neves-timeline-3d"` em `game/package.json`.
  4. Em `Title.js` l. 88, atualizar o prefixo do título dinâmico da aba para `'Victor'`.
  5. Remover import morto de `EasterArea` em `Areas.js` e deletar/limpar arquivos promocionais não usados (`BlackFriday/`, `Easter.js`, `EasterArea.js`, `blackFriday.styl`, `easter.styl`).
  6. Mover os 3 arquivos `.wav` de `game/static/sounds/musics/` para `game/resources/sounds/musics/`.
- **Validação:** `npm.cmd run build` + conferir tamanho de `game/dist/sounds/musics/` e aba Network sem `gtag`.
- **DoD:** 0 scripts de analytics externos; `dist/` ~136 MB menor; aba do navegador exibe `Victor 🚗🌳...`.

#### `T0.2` — Modo Standalone / Offline-First Completo
- **Pré-requisito:** `T0.1`.
- **Arquivos:** `game/sources/Game/Server.js`, `game/sources/Game/Options.js`, `game/sources/Game/World/Whispers.js`, `game/sources/index.html`, `game/sources/style/general.styl`, `game/sources/Game/World/Areas/CircuitArea.js`, `CookieArea.js`, `AltarArea.js`
- **Passos:**
  1. Adicionar `this.isStandalone = !import.meta.env.VITE_SERVER_URL` em `Server.js` e aplicar `document.documentElement.classList.add('is-standalone')`.
  2. Via CSS (`is-standalone`), ocultar `.offline-element`, aba `whispers` do menu e linha `Server` em `Options`; adicionar nota discreta `.standalone-element` no Circuito.
  3. Em `Whispers.js`, evitar registrar atalho `T` quando `this.game.server.isStandalone`.
  4. Em `CookieArea.js`, inicializar `this.counter.init()` no modo standalone lendo/salvando `vn_cookies_count_v1` em `localStorage`.
  5. Em `AltarArea.js`, ler/salvar `vn_altar_count_v1` em `localStorage`, atualizar texto e `progressUniform = (value % 5) / 5`, e disparar o evento de cataclismo localmente a cada 5 sacrifícios.
  6. Em `CircuitArea.js`, implementar leitura/gravação do Top 5 em `vn_circuit_scores_v1`, habilitar formulário de iniciais/bandeira offline e atualizar tabela HTML + placar 3D.
- **Validação:** testar Circuito, Cookie, Altar, Menu e Opções sem servidor; dar F5 e confirmar persistência.
- **DoD:** zero avisos vermelhos de servidor offline; todos os mini-games persistem progresso localmente (Gate **G0 parcial**).

#### `T0.3` — Unificação `.png`/`.ktx` e `scripts/compress.js` Windows-Friendly
- **Pré-requisito:** `T0.1`.
- **Arquivos:** `game/sources/Game/World/Areas/ProjectsArea.js`, `game/sources/Game/World/Areas/LabArea.js`, `game/sources/Game/World/Intro.js`, `game/scripts/compress.js`
- **Passos:**
  1. Em `ProjectsArea.js`, `LabArea.js` e `Intro.js`, ler `const compressed = !!import.meta.env.VITE_COMPRESSED` e escolher `textureKtx` + `.ktx` ou `texture` + `.png` (aceitando nomes com ou sem extensão em `projects.js` e `lab.js`).
  2. Em `scripts/compress.js`: normalizar `\` → `/` antes dos regexes de presets, usar `node_modules/.bin/gltf-transform` com suporte a Windows, checar `toktx` antes de disparar conversão KTX2, limitar concorrência a 4 jobs e aceitar subpasta como argumento CLI.
- **Validação:** `node scripts/compress.js static/ui` + editar temporariamente um `.png` de `projects/images/` e vê-lo em `npm.cmd run dev`.
- **DoD:** Gate **G0** 100% aprovado.

---

### Fase 1 — Substituição Completa de Conteúdo (Victor Neves) + I18n

#### `T1.1` — Home, Bastidores, `consoleLog.js`, `social.js` e Limpeza de `SocialArea`
- **Pré-requisito:** `T0.2`.
- **Arquivos:** `game/sources/index.html`, `game/sources/data/consoleLog.js`, `game/sources/data/social.js`, `game/sources/Game/World/Areas/SocialArea.js`, `game/sources/style/discord.styl` (ou `contact.styl`), `game/sources/style/index.styl`
- **Passos:**
  1. Reescrever `home-content` e `behindTheScene-content` em `sources/index.html` com apresentação de Victor Neves e stack do projeto.
  2. Reescrever `sources/data/consoleLog.js` com ASCII `VICTOR NEVES` e links reais.
  3. Substituir `sources/data/social.js` pelas 6 entradas de Victor Neves e converter modal `discord` → modal `contact` ("Vamos conversar").
  4. Em `SocialArea.js`, localizar os filhos `baguiraPhysicalDynamic`, `sudoPhysicalDynamic`, `boyPhysicalDynamic`, `twitchPhysicalDynamic`, `blueskyPhysicalDynamic.001` e `discordPhysicalDynamic`, ocultando a malha (`visible = false`) e desabilitando seus corpos físicos (`setEnabled(false)`).
- **Validação:** abrir Home, Bastidores, Console DevTools e dirigir até `SocialArea` clicando nos links e no modal Contato.
- **DoD:** nenhum link, figura ou texto legado visível na Home, Bastidores, Console ou Social.

#### `T1.2` — Sistema Bilíngue PT-BR (Padrão) / EN
- **Pré-requisito:** `T1.1`.
- **Arquivos:** `game/sources/data/i18n.js` (novo), `game/sources/Game/I18n.js` (novo), `game/sources/Game/Game.js`, `game/sources/Game/Options.js`, `game/sources/index.html`, `game/sources/Game/Map.js`, `game/sources/Game/World/Areas/*.js`, `game/static/intro/*Label.png`
- **Passos:**
  1. Criar `data/i18n.js` e `Game/I18n.js` com dicionários `pt-BR` e `en` (Seção 5.1) e inicializar no `Game.js`.
  2. Anotar `data-i18n` / `data-i18n-html` em `sources/index.html` e adicionar seletor `Idioma / Language` em `Options.js`.
  3. Integrar `this.game.i18n.t(...)` aos pins do `Map.js` e aos prompts de `InteractivePoints` das áreas.
  4. Gerar novas texturas limpas `256×128` para `static/intro/*Label.png` em PT-BR (ou visuais universais de teclas/gestos).
- **Validação:** alternar `PT-BR ↔ EN` em `Options` e testar Menu, Controles, Mapa, Opções e prompts 3D sem recarregar.
- **DoD:** experiência abre em PT-BR por padrão e troca instantaneamente para EN com persistência em `vn_lang`.

#### `T1.3` — Projetos de Victor Neves (`ProjectsArea`)
- **Pré-requisito:** `T0.3`, `T1.2`.
- **Arquivos:** `game/sources/data/projects.js`, `game/sources/Game/World/Areas/ProjectsArea.js`, `game/static/projects/images/*`
- **Passos:**
  1. Preparar as 16 screenshots (`960×540` PNG) dos 6 projetos reais de Victor (`dtcg-contrast`, `snake-arena`, `Meu Poupig`, `js-games`, `xbox-sales`, `Financial Sample Analysis`) em `static/projects/images/`.
  2. Remover as 31 imagens antigas de projetos placeholder de `static/projects/images/`.
  3. Atualizar `sources/data/projects.js` conforme Seção 5.3 (`distinctions: []`) e confirmar que `ProjectsArea.js` lida com `distinctions` vazio sem erros.
- **Validação:** dirigir até `ProjectsArea`, abrir a câmera cinemática, passar por todos os 6 projetos e todas as fotos, testar clique no link externo e verificar conquista `projects`.
- **DoD:** 6 projetos reais do Victor navegáveis em alta nitidez, 0 projetos placeholder.

#### `T1.4` — Carreira / Timeline de Victor Neves (`CareerArea` + Gerador RG)
- **Pré-requisito:** `T1.2`.
- **Arquivos:** `game/scripts/generate-career-textures.mjs` (novo), `game/static/career/*.png`, `game/sources/Game/World/Areas/CareerArea.js`
- **Passos:**
  1. Criar `scripts/generate-career-textures.mjs` usando SVG + `sharp` para gerar os 6 PNGs RG nas dimensões exatas da Seção 5.2.
  2. Executar o script e substituir os 6 arquivos `.png` em `game/static/career/`.
  3. Em `CareerArea.js`, atualizar as 4 cores de linha para a nova paleta e aplicar o mapeamento de anos `1994 → 2026` no display de 7 segmentos.
- **Validação:** dirigir do início ao fim da `CareerArea` de dia e de noite; checar orientação vertical (`flipY`), contraste e sincronia dos anos.
- **DoD:** 6 blocos legíveis contando toda a trajetória de Victor (1994–2026) com display 7-segmentos sincronizado.

#### `T1.5` — Lab, Máquina do Tempo (`TimeMachineArea`) e Conquistas (`achievements.js`)
- **Pré-requisito:** `T0.3`, `T1.2`.
- **Arquivos:** `game/sources/data/lab.js`, `game/static/lab/images/*`, `game/sources/Game/World/Areas/TimeMachineArea.js`, `game/static/timeMachine/*.png`, `game/sources/data/achievements.js`, `game/sources/Game/Achievements.js`
- **Passos:**
  1. Popular `sources/data/lab.js` com os 6 experimentos reais do Victor + pares de imagens (`960×540` + `240×136`) em `static/lab/images/`, removendo os arquivos antigos.
  2. Gerar as 2 telas retrô `140×124` (`Ponto Interativo 2005` e `Timeline 2D`) em `static/timeMachine/` e atualizar `TimeMachineArea.js` para abrir `https://voaneves.github.io/timeline/#carreira`.
  3. Reescrever `sources/data/achievements.js` com as 37 conquistas da Seção 5.6 (integrando tradução PT-BR/EN em `Achievements.js`), ajustando `areas` para `12` e removendo dependência de `whisper`.
- **Validação:** testar `LabArea`, bater na TV da `TimeMachineArea`, abrir aba `Conquistas` e auditar strings residuais.
- **DoD:** Gate **G1** 100% aprovado.

---

### Fase 2 — Spin Visual por Código, Shaders TSL e Paleta (Sem Blender)

#### `T2.1` — Nova Atmosfera, Iluminação e Ciclos de Dia
- **Pré-requisito:** `T1.5`.
- **Arquivos:** `game/sources/Game/Cycles/DayCycles.js`, `game/sources/Game/Ligthing.js`, `game/sources/Game/World/Areas/BehindTheSceneArea.js`
- **Passos:**
  1. Aplicar os 4 presets costeiros (`day`, `dusk`, `night`, `dawn`) da Seção 2.3 em `DayCycles.js`.
  2. Alterar `bounceColor` em `Ligthing.js` para `#5a8c7a`.
  3. Alterar `bloomColor` em `BehindTheSceneArea.js` para `#2ad4d9`.
  4. Validar todos os 4 horários via slider no `#debug` (inclusive `VITE_DAY_CYCLE_PROGRESS` em testes rápidos).
- **DoD:** iluminação limpa, vibrante e coerente nos 4 momentos do dia, sem sombra roxa/magenta exagerada.

#### `T2.2` — Água Costeira, Terreno, Grama Orgânica e Bioma de Árvores
- **Pré-requisito:** `T2.1`.
- **Arquivos:** `game/sources/Game/Terrain.js`, `game/sources/Game/World/Floor.js`, `game/sources/Game/World/WaterSurface.js`, `game/sources/Game/World/Grass.js`, `game/sources/Game/World/World.js`
- **Passos:**
  1. Atualizar gradiente de água/areia (`#f4d38c` → `#34cfc4` → `#12487a`) e `grassColorUniform` (`#76c442`) em `Terrain.js`.
  2. Atualizar `slabHighColor` (`#f7e5c2`) e `slabLowColor` (`#b3957a`) em `Floor.js`.
  3. Atualizar cores das 3 famílias de árvores em `World.js` (esmeralda, dourado solar e coral suave).
  4. Polir `Grass.js` (gradiente vertical `#468c2e` → `#76c442` → `#b7eb5d`, curvatura de lâmina e resposta suave ao vento/rodas) e `shoreEdge` em `WaterSurface.js`.
- **Validação:** percorrer costa, pontes, cachoeira (`AchievementsArea`) e gramados em Desktop Q0 e Mobile Q1.
- **DoD:** visual costeiro vivo, água turquesa translúcida, grama estilizada fluida a 60 fps.

#### `T2.3` — Curadoria da Paleta, Pinturas do Carro, Altar, `circuitBrand` e Previews UI
- **Pré-requisito:** `T2.2`.
- **Arquivos:** `game/static/palette.png` (backup em `game/resources/palette-original.png`), `game/sources/Game/Materials.js`, `game/sources/Game/World/VisualVehicle.js`, `game/static/areas/satanStar.png`, `game/sources/Game/World/Areas/CircuitArea.js`, `game/static/circuit/brand.png` (novo), `game/static/ui/previews/*`, `game/static/ui/achievements/rewards/*`, `game/static/social/share-image.png`
- **Passos:**
  1. Fazer backup de `palette.png` e aplicar refinamentos controlados de saturação/alegria tátil (respeitando a Regra de Ouro: reverter qualquer swatch que piore algum mini-game).
  2. Atualizar as 6 pinturas do veículo (`Materials.js` + `VisualVehicle.js`) e gerar os 6 thumbnails correspondentes em `static/ui/achievements/rewards/*.png` (e `.webp`).
  3. Substituir `static/areas/satanStar.png` (`128×128`) por um glifo geométrico/vórtice limpo (canal `R`).
  4. Criar textura `static/circuit/brand.png` própria e aplicá-la em runtime no material `circuitBrand` dentro de `CircuitArea.js` (substituindo a marca legada nos banners da pista).
  5. Capturar novas imagens `600×600` para `static/ui/previews/*.png` → `.webp` e nova `static/social/share-image.png` (`1200×630`).
- **Validação:** inspecionar todas as 12 áreas + todas as abas do Menu + todas as 6 pinturas do carro em Dia e Noite.
- **DoD:** Gate **G2** 100% aprovado.

---

### Fase 3 — Melhorias de Gameplay & Mini-games (Sem Quebrar Assets Originais)

#### `T3.1` — Circuito Turbinado (Medalhas Ouro/Prata/Bronze + Delta de Recorde)
- **Pré-requisito:** `T0.2`, `T2.3`.
- **Arquivos:** `game/sources/Game/World/Areas/CircuitArea.js`, `game/sources/index.html`, `game/sources/style/circuit.styl`, `game/sources/style/circuit-end.styl`
- **Passos:**
  1. Implementar cálculo de medalhas (Ouro `< 28s`, Prata `< 34s`, Bronze `< 42s`) e exibição do badge + delta para o melhor tempo pessoal no modal `circuit-end`.
  2. Exibir ícone da medalha em cada linha do Top 5 local na aba `Circuit` e adicionar botão discreto `"Limpar recordes"` com confirmação.
  3. Disparar confete no pódio (`refPodiumConfettiA/B`) sempre que o jogador conquistar novo #1 local.
- **Validação:** correr 2–3 voltas completas, testar reset no meio da corrida, bater recorde e conferir persistência após F5.
- **DoD:** circuito viciante e recompensador 100% offline sem mexer na física/geometria da pista.

#### `T3.2` — Polimento de Exploração, Mapa com Progresso e Check de Dispositivos
- **Pré-requisito:** `T3.1`.
- **Arquivos:** `game/sources/Game/Map.js`, `game/sources/style/map.styl`, `game/sources/Game/Notifications.js`, `game/sources/Game/World/Areas/BowlingArea.js`, `CookieArea.js`
- **Passos:**
  1. Adicionar classe `.is-visited` nos pins de `Map.js` consultando `this.game.achievements.groups.get('areas').progress` + contador discreto `X / 12 áreas descobertas` no canto do mapa.
  2. Adicionar micro-notificação não-invasiva ao descobrir uma área pela primeira vez.
  3. Testar todos os mini-games (`Circuit`, `Bowling`, `Cookie`, `Altar`, `Toilet`) em teclado/mouse, emulação mobile touch (`390×844`) e gamepad (se disponível), corrigindo qualquer conflito de foco/modal.
- **DoD:** Gate **G3** 100% aprovado.

---

### Fase 4 — Edições Pontuais de Assets 3D no Blender (Com Critério de Coesão)

*Pré-requisito de ambiente: instalar Blender localmente e duplicar o arquivo `.blend` base em `game/resources/` para `game/resources/timeline-world.blend`.*

#### `T4.0` — Script de Validação de Contrato `.glb` (`verify-glb.mjs`)
- **Pré-requisito:** `T3.2`.
- **Arquivos:** `game/scripts/verify-glb.mjs` (novo), `game/package.json` (adicionar `"verify:glb": "node scripts/verify-glb.mjs"`)
- **Passos:** implementar a validação estrutural da Seção 6.3 lendo os cabeçalhos JSON de `areas.glb` e `respawnsReferences.glb`.
- **DoD:** `npm.cmd run verify:glb` passa no `areas.glb` atual e acusa corretamente os 3 nós legados de `Social` como pendência da `T4.2`.

#### `T4.1` — Letras Físicas `VICTOR NEVES` na `LandingArea`
- **Pré-requisito:** `T4.0`, Blender instalado.
- **Arquivos:** `game/resources/timeline-world.blend` → `game/static/areas/areas.glb`
- **Passos:**
  1. Substituir as 10 letras antigas pelas 11 letras `VICTOR NEVES` mantendo altura, espessura, bevel, UV no swatch da `palette` (nó de textura mutado), nomeação `refLettersPhysicalDynamic.*`, custom property `mass = 0.2` e colliders `cuboid*`.
  2. Exportar `areas.glb` sem compressão e rodar `npm.cmd run verify:glb`.
  3. Testar no jogo acelerando contra cada letra (física, som `hitBrick` e `Reset`).
- **DoD:** `VICTOR NEVES` com acabamento idêntico ao original, derrubável e resetável sem glitches.

#### `T4.2` — Limpeza Geométrica de `SocialArea` e Consolidação de `CircuitArea`
- **Pré-requisito:** `T4.1`.
- **Arquivos:** `game/resources/timeline-world.blend` → `game/static/areas/areas.glb`, `game/sources/Game/World/Areas/SocialArea.js`
- **Passos:**
  1. Remover definitivamente `baguiraPhysicalDynamic`, `sudoPhysicalDynamic`, `boyPhysicalDynamic` e as 3 placas de redes não usadas (`twitch`, `bluesky`, `discord`) da coleção `social`.
  2. Substituir `refStatuePhysicalDynamic` por um monumento/totem geométrico estilizado (derrubável, com `cuboid*` ajustado, mantendo a conquista `statueDown`).
  3. Consolidar a textura do material `circuitBrand` no `.blend` (mantendo **intactos** todos os assets de `Bowling`, `Cookie`, `Toilet`, `Achievements`, `TimeMachine` e `Vehicle`).
  4. Remover o workaround de ocultação em código de `SocialArea.js` que já não for necessário e rodar `npm.cmd run verify:glb`.
- **DoD:** Gate **G4** 100% aprovado.

---

### Fase 5 — Spin no Layout da Fase (*Roadtrip Costeira*) e Novo Mapa

#### `T5.1` — Reorganização da Ilha (Anel Narrativo + Penínsulas de Mini-games)
- **Pré-requisito:** `T4.2` (Gate `G4`) e confirmação da Decisão `D10`.
- **Arquivos:** `game/resources/timeline-world.blend` → `game/static/areas/areas.glb`, `game/static/respawns/respawnsReferences.glb`, `game/static/scenery/scenery.glb`, `game/static/terrain/terrain.png`, `game/static/terrain/terrain.glb`, `*References.glb` de vegetação/props
- **Passos:**
  1. Reposicionar as 13 áreas e seus respectivos `refZoneBounding*` / `refZoneFrustum*` conforme a tabela da Seção 4.4.
  2. Reposicionar todos os `respawn*` em `respawnsReferences.glb` (alinhando `rotation.y` para o carro nascer olhando para a estrada/área).
  3. Pintar novo `terrain.png` (`512×512` RGBA) desenhando o anel principal de pedra (`R`), gramados (`G`) e recorte costeiro/ilhota (`B`) sincronizado com o heightfield de `terrain.glb`.
  4. Reposicionar referências de árvores, arbustos, flores, cercas, bancos, postes, lanternas e caixotes explosivos para emoldurar a nova estrada sem obstruir pistas nem spawns.
  5. Exportar todos os `.glb` afetados e validar com `npm.cmd run verify:glb`.
- **DoD:** volta completa pelo anel narrativo e todos os mini-games sem colisões invisíveis, sem objetos flutuando e com frustum culling limpo.

#### `T5.2` — Novo Mapa 2D (Dia e Noite), Pins Recalibrados e Previews Atualizados
- **Pré-requisito:** `T5.1`.
- **Arquivos:** `game/static/ui/map/map-day.png`, `map-night.png`, `map-day.webp`, `map-night.webp`, `game/sources/Game/Map.js`, `game/static/ui/previews/*`
- **Passos:**
  1. Renderizar vista ortográfica top-down (`1024×1024`) exata dos `192 × 192 m` em iluminação Dia e Noite, converter para `.webp` e atualizar também `stylizedMap` no quiosque do `Landing`.
  2. Recalibrar `offset` de todos os 12 pins em `Map.js` e validar teleporte de cada um.
  3. Atualizar os previews `600×600` do Menu refletindo a nova geografia.
- **DoD:** Gate **G5** 100% aprovado.

---

### Fase 6 — Compressão de Produção, Auditoria Final e Integração com a Raiz

#### `T6.1` — Compressão de Produção (`Draco` + `KTX2` + `WebP`) e `VITE_COMPRESSED=1`
- **Pré-requisito:** `T5.2` (ou `T4.2` se pular Fase 5), KTX-Software (`toktx`) instalado.
- **Arquivos:** `game/static/**`, `game/.env.production` (ou variável de build)
- **Passos:**
  1. Executar `npm.cmd run compress` e revisar o log garantindo 0 falhas e presets `uastc` corretos em `palette.ktx`, `terrain.ktx` e `career/*.ktx`.
  2. Rodar `VITE_COMPRESSED=1 npm.cmd run build` e testar em `npm.cmd run preview`.
  3. Inspecionar aba Network (0 erros 404; todos os modelos `-compressed.glb` e texturas `.ktx`/`.webp` carregados) e conferir fidelidade visual lado a lado com o modo dev.
- **DoD:** build de produção 100% comprimido, leve e visualmente fiel.

#### `T6.2` — Auditoria Final de Qualidade, WebGPU/WebGL2, Mobile e Performance
- **Pré-requisito:** `T6.1`.
- **Arquivos:** `game/` completo
- **Passos:**
  1. Executar busca automatizada de strings confirmando 0 referências residuais a conteúdo ou links legados.
  2. Testar Desktop WebGPU (`Q0`), Desktop WebGL2 fallback e Mobile (`390×844`, `Q1`, controles touch).
  3. Registrar medições finais de FPS, draw calls e peso total de `game/dist/`.
- **DoD:** Gate **G6** 100% aprovado.

#### `T6.3` — Integração com o Site Raiz (`D:\GitHub\_kit-clones\timeline`) *(Somente após aprovação)*
- **Pré-requisito:** `T6.2` + autorização explícita do dono.
- **Arquivos:** `D:\GitHub\_kit-clones\timeline\index.html`, script de cópia/deploy para `play/` (ou GitHub Actions)
- **Passos:**
  1. Publicar `game/dist/` em `play/` (ou rota definida em `D12`).
  2. Conectar o botão `"Jogar em 3D"` da página raiz ao `./play/` e o retorno dentro do jogo ao `../#carreira`.
  3. Validar que a página raiz 2D permanece acessível e com Lighthouse 100.
- **DoD:** fluxo completo Timeline 2D ↔ Experiência 3D funcionando ponta a ponta.

---

## 10. Matriz de Riscos, Decisões do Dono (`D1`–`D12`) e Checklist Final

### 10.1 Matriz de Riscos e Mitigações
| Risco | Prob. | Impacto | Mitigação concreta |
|---|---|---|---|
| `Grass.js` quebrado impede iniciar o projeto hoje | Certo | Alto | Resolvido imediatamente na `T0.0` antes de qualquer outra mudança. |
| Quebra de `References.js`, `extras` ou colisores ao editar `areas.glb` no Blender | Média | Alto | Fases 0–3 não tocam no `.glb`; na Fase 4/5 usar cópia `timeline-world.blend` + validação automatizada obrigatória via `verify-glb.mjs`. |
| Regexes de `compress.js` falharem no Windows (`\` vs `/`) corrompendo `palette.ktx` / `terrain.ktx` | Alta | Alto | Corrigido na `T0.3` com normalização de barras + conferência visual na `T6.1`. |
| Troca de assets em mini-games piorar estética ou física | Média | Alto | Regra de Ouro (Seção 1.3): preservar geometria/física de `Circuit`, `Bowling`, `Cookie`, `Toilet` e `Vehicle`; reverter qualquer troca que não combine. |
| `toktx` ausente bloquear iteração de texturas 2D | Alta | Médio | `T0.3` unifica `ProjectsArea`/`LabArea`/`Intro` para carregar `.png` quando `VITE_COMPRESSED=` estiver vazio; `toktx` só é exigido na `T6.1`. |
| Texturas RG de `CareerArea` aparecerem invertidas (`flipY = false`) ou ilegíveis à noite | Média | Médio | Script `generate-career-textures.mjs` parametrizado com teste imediato em Dia e Noite na `T1.4`. |
| Build inflado com 136 MB de `.wav` mortos em `static/sounds/musics/` | Certo | Médio | Movidos para `resources/sounds/musics/` já na `T0.1`. |
| Queda de FPS em celulares por shaders de grama/água | Média | Médio | `Quality.level = 1` reduz instâncias de grama, desliga blur da água (`WaterSurface.js`) e desliga `cheapDOF` (`Rendering.js`). |

### 10.2 Decisões do Dono (`D1`–`D12`) — Padrões Sugeridos
| ID | Tema | Padrão adotado neste plano | Alternativa aberta |
|---|---|---|---|
| **D1** | Idioma padrão | **PT-BR padrão** com toggle `PT-BR / EN` em `Options` | EN padrão com toggle PT-BR |
| **D2** | Direção visual | **Roadtrip Costeira Tátil** (solar/turquesa/alegre, sem forçar marca pessoal) | Puxar mais para paleta editorial papel/vermelho |
| **D3** | Pintura inicial do carro | **Coral Solar** (`#ff5a36` → `#d92b4b`) | Turquesa Costa ou Amarelo Solar |
| **D4** | `Whispers` sem servidor | **Oculto** quando `VITE_SERVER_URL` estiver vazio | Mural local em `localStorage` |
| **D5** | Contador 7-segmentos da `CareerArea` | **Curva de marcos (`1994` → `2026`)** | Linear `2011` → `2026` (1 m = 1 ano) |
| **D6** | Estátua derrubável na `SocialArea` | Ocultar figuras legadas na F1 e **trocar estátua por totem geométrico** na F4 | Remover estátua e conquista `statueDown` |
| **D7** | Easter egg `OnlyFans` (ventiladores) | **Manter mecânica** (rótulo leve `"Fãs"` / `"OnlyFans"`) | Remover ponto interativo |
| **D8** | Re-tema do `AltarArea` | **Trocar `satanStar.png` por vórtice geométrico** + cataclismo offline (5 entradas) | Manter visual original e só ligar modo offline |
| **D9** | Destino da `TimeMachineArea` | Abrir **Timeline 2D (`#carreira`)** + telas retrô *Ponto Interativo 2005* | Abrir modal interno retrô |
| **D10** | Rearranjo de layout na Fase 5 | **Sim** — anel narrativo costeiro (`Landing → Career → Social → Lab → Projects`) | Manter layout atual e mudar apenas visual/texturas |
| **D11** | Trilha sonora | **Manter playlist instrumental ambiente atual** (apenas `.mp3`) | Substituir por trilha própria futura |
| **D12** | Integração com a raiz | Build em `play/` ligado ao botão `"Jogar em 3D"` (mantendo site 2D intacto) | Hospedar em subdomínio/repo separado |

### 10.3 Checklist Final de "Pronto para Publicar"
- [ ] `T0.0` concluída: `Grass.js` integrado ao `terrainNode` + `Tracks`, build e dev rodando limpos.
- [ ] `npm.cmd run build` (dev e `VITE_COMPRESSED=1`) com 0 erros e `dist/` livre dos 136 MB de `.wav`.
- [ ] Zero menções residuais a textos, marcas, analytics (`G-JMSN30BQ5J`) ou URLs legadas.
- [ ] 100% do conteúdo de **Victor Neves** validado em **PT-BR e EN**: Carreira (6 blocos + display `1994–2026`), Projetos (6 projetos reais), Lab (6 experimentos), Social (links + Modal Contato), TimeMachine (versão 2D + 2 telas CRT) e 37 Conquistas.
- [ ] Modo 100% offline-first validado: Circuito (Top 5 + medalhas Ouro/Prata/Bronze), Cookie (contador 3D), Altar (cataclismo a cada 5 entradas) e Conquistas persistem após recarregar.
- [ ] Spin visual *Roadtrip Costeira Tátil* validado em `day`, `dusk`, `night`, `dawn`, chuva e neve; todos os mini-games (`Circuit`, `Bowling`, `Cookie`, `Toilet`) preservados e visualmente coesos.
- [ ] Letras `VICTOR NEVES` funcionam fisicamente no `LandingArea` e figuras legadas removidas de `SocialArea` (`verify-glb.mjs` verde).
- [ ] Desktop (WebGPU + WebGL2 fallback) e Mobile (`Quality.level = 1`, touch `Nipple`) testados com performance estável e 0 erros 404.
