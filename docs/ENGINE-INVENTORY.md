# Inventário do motor folio-2025 (T0.3)

Resultado da tarefa T0.3 do `PLAN-3D.md`. Fonte: clone de leitura `D:\GitHub\_vendor\folio-2025` no commit `70764a9` (2026-11-04, "Bump up dependencies (not Rapier because of sleep bug)"). Escopo: os 118 arquivos de `sources/Game/**` (28 873 linhas), mais `sources/index.js`, `sources/threejs-override.js`, `sources/index.html`, `vite.config.js` e `scripts/compress.js`. Nada de `static/` ou `resources/` foi copiado para fora do clone.

Método: script que extrai `import` (ignorando linhas comentadas), importadores reversos, usos de `game.server`, `resources.*` e caminhos de assets; depois leitura manual dos arquivos do núcleo (Game, Rendering, View, Physics, Objects, Materials, MeshDefaultMaterial, Lighting, Fog, Terrain, Tracks, Reveal, Inputs, Quality, Debug, ResourcesLoader, Respawns, Events, Ticker). O fecho por `import` sozinho é enganoso porque quase tudo importa `Game.js`: o acoplamento real é por membros do singleton (`game.reveal`, `game.terrain`, ...). Por isso o fecho abaixo foi montado por membros usados, não só por imports.

Legenda das classes (do plano): K manter, A adaptar, R reescrever, D descartar. Veredito: **OK** confirma a linha de 6.3, **OK\*** confirma com ressalva de acoplamento, **CORR** corrige a classe ou a nota.

---

## 1. Resumo

- Dos 118 arquivos: **82 OK, 17 OK\*, 19 CORR** (tabela da seção 5).
- A tabela 6.3 está **majoritariamente certa**, mas subestima o acoplamento do núcleo: `MeshDefaultMaterial` exige cinco singletons (`lighting`, `fog`, `water`, `terrain`, `reveal`), então `Terrain`, `Tracks` e uma versão mínima de `Reveal` entram no motor mínimo. Não dá para "descartar" `Reveal` nem tratar `Terrain` como opcional.
- O **motor vazio** (chão + 1 cubo dinâmico, renderer, física, entradas, câmera, debug) fecha em **33 arquivos existentes de `sources/Game/` (5 827 linhas) + 2 novos** (`Game.js` adaptado e `World/World.js` mínimo), mais 2 arquivos fora de `Game/` (`index.js`, `threejs-override.js`). Lista exata na seção 3.
- Achado que **quebra o plano 6.4**: `Events.trigger` itera as prioridades com `for...in` sobre um array; a prioridade `5.5` (`CharacterController:post-physics`) rodaria **depois do render (998)**. Ver C-01.
- Nada em `sources/Game/**` embute código de terceiros com licença própria (sem cabeçalhos de copyright). Os riscos de licença estão em `static/` e `resources/` (seção 4), que não serão copiados.

---

## 2. Correções à tabela 6.3 e à seção 0.2

### 2.1 Correções (CORR)

| Id | Linha de 6.3 | Correção |
|---|---|---|
| C-01 | `Events.js` K; 6.4 "prioridades `5.5`" | `Events.on(name, cb, order)` guarda callbacks em `callbacks[name][order]` (array esparso) e `trigger` usa `for(const order in array)`. Em JS, só chaves inteiras são enumeradas em ordem crescente; `5.5` é chave string e vem **depois** de todas as inteiras (testado: ordem `3, 7, 998, 5.5`). **Usar só inteiros** (ex.: reescalar para 5→50, 6→60 ou pôr o controlador em 5 antes de `Objects`=4/`View`=7, nunca fracionário) ou corrigir `Events` para ordenar. Prioridades reais no upstream: 0 Inputs/Time, 1 View(resize)/Player, 2, 3 Physics/Lighting, 4 Objects/Wireframe, 5-6 Player/PhysicsVehicle, 7 View, 8 Cycles/Weather/Zones, 9 Lighting/Tracks/Wind, 10 mundo, 13-14 áudio/UI, 998 Rendering, 1000+ Player/Server. |
| C-01b | `Fog.js, Wind.js, Water.js, WaterSurface` K/A; `Weather.js` D | `Wind.js` lê `game.weather.wind` e `game.noises.perlin`, e é consumido por Grass, Foliage, Flowers, Leaves e WindLines (`wind.offsetNode`). `Weather` lê `yearCycles` e `dayCycles`. Também leem `weather`: WaterSurface (`temperature`, `rain`), WindLines (`wind`), Audio (`snow`, `rain`, `wind`). Logo `Weather` não é D "limpo": ou vira um stub A (`wind`, `temperature`, `rain`, `snow` fixos) ou cada consumidor é adaptado. `YearCycles` (D) é lido por `Weather` e `Leaves` (`humidity`, `leaves`, `temperature`). Recomendação: `Weather.js` → **A mínimo**, `YearCycles` → D só junto com `Leaves` adaptado. |
| C-02 | `Terrain.js` A (sem destaque) | **Está no fecho mínimo.** `MeshDefaultMaterial` (padrão `hasLightBounce: true`) chama `game.terrain.terrainNode/colorNode`. `Terrain` lê `resources.terrainTexture` (`terrain/terrain.png`, arte do Bruno, **não copiar**) e `game.tracks.renderTarget`. Para o motor vazio: gerar uma `DataTexture` procedural (canais: g = grama, b = índice do gradiente terra/água) e/ou `hasLightBounce:false` por padrão. `Tracks.js` (RT 512×512 renderizado **todo tick** com `resetRendererState`) entra junto; `Terrain.js` importa `MeshGridMaterial` sem usar (linha 3). |
| C-03 | `Reveal.js, World/Intro.js` R | `Reveal` não pode ser só reescrito/descartado: `MeshDefaultMaterial` lê `game.reveal.{position2Uniform, distance, thickness, color, intensity}` em **todo** material com `hasReveal` (padrão true), e `World/Grid.js` lê `reveal.position/distance`. Mínimo: `Reveal` reduzido a uniforms (distance grande = sem descarte) + `update()` lendo `dayCycles.properties.revealColor/revealIntensity`. O resto (steps 0-2) depende de `world.intro`, `world.grid`, `world.cherryTrees`, `rayCursor`, `overlay`, `menu`, `interactivePoints` e chama `game.server.start()`: esse trecho é R. |
| C-04 | `Materials/MeshDefaultMaterial.js` A | Dependências duras: `lighting` (11 usos), `reveal` (7), `water` (2), `terrain` (2), `fog` (2). Qualquer cena mínima precisa dos cinco singletons já criados antes do primeiro build de shader. Ordem original: `view → rendering.setPostprocessing → reveal → noises → weather → wind → tracks → lighting → fog → water → materials → objects`. |
| C-05 | `Respawns.js` K ("vindos de `refRespawn*`") | O construtor lê `resources.respawnsReferencesModel.scene.children` (`respawns/respawnsReferences.glb`, do Bruno) e usa o regex `^respawn(.+)$` com y fixo 4, **não** `refRespawn*`. `View.setFocusPoint` e `Reveal` chamam `respawns.getDefault()` no boot. Classe: **A** (fonte própria; para o motor vazio, um `Map` com 1 respawn em código). O prefixo `ref<Nome><n>` do plano vale para `References.js` (regex confirmada), não para `Respawns`. |
| C-06 | `Zones.js` K | Lê `game.player.position` (1 uso): **A trivial**. |
| C-07 | `Debug.js` K "`import()` dinâmico"; `Monitoring.js` K | Viável, mas exige `await Debug.load()` no início de `Game.init()` (já é `async`) porque ~44 arquivos usam `game.debug.panel.addFolder(...)` de forma síncrona sob `debug.active` (`location.hash.match(/debug/i)`); `Cycles.js` chama `debug.addManualBinding` sempre (funciona sem painel). Além disso `Rendering.js` importa de forma **estática** `three/addons/inspector/Inspector.js` (só usado com `#inspector`): tornar dinâmico. `Monitoring.js` é **código morto** (import e `new` comentados em `Game.js`; `Rendering.setStats` já cobre `#stats`): **D**, não K. |
| C-08 | `Quality.js` A (tiers 0/1/2) | `quality.level` é lido como booleano (`=== 0 ? A : B`) em ~15 pontos: Ligthing (3: `mapSize` 2048/512, `shadowRadius`), View (3: `phi` 0.31/0.27, tracking), Rendering (2: `_nMips`, `qualityChange`), Options (3), PhysicsVehicle (1), Intro (1), WaterSurface (1), Game (1: `PreRenderer`). `Rendering.qualityChange` só trata 0 e 1: um tier 2 deixaria o `outputNode` anterior. `cheapDOFPass` é sempre construído e `View` o anima em modo cinemático (`rendering.cheapDOFPass.strength`): precisa de guarda nos tiers sem DOF. |
| C-09 | `Cycles/Cycles.js, DayCycles.js` A → `EraCycles` | Contrato que `EraCycles` precisa expor (lido por Lighting, Fog, Reveal, Weather, Audio, Map, Player): `progress`, `absoluteProgress`, `events`, `intervalEvents`, e `properties.{revealColor, revealIntensity, electricField, temperature, lightColor, lightIntensity, shadowColor, fogColorA, fogColorB, fogNearRatio, fogFarRatio}`. `Cycles` usa relógio real (`Date.now()/1000/duration`, override por `VITE_DAY_CYCLE_PROGRESS`): não determinístico, o que atrapalha testes visuais; o plano deve fixar o progresso. |
| C-10 | `PreRenderer.js` K | Faz deep import `three/src/renderers/common/CubeRenderTarget.js`, que traz uma **segunda cópia** da classe em relação ao bundle `three/webgpu` (risco de `instanceof` e de peso). Os demais deep imports (`three/src/math/MathUtils.js` em Nipple, Player, Map, CareerArea, VisualVehicle) são funções puras e inofensivos. Classe: **A** (usar o export de `three/webgpu`, a confirmar). Só roda no tier 0 com backend WebGPU (`Game.js:203`). |
| C-11 | `Audio.js` A "engine mantida" | O arquivo mistura engine e conteúdo: engine = `init` + `register()` + `setMute` + `update` (~200 L); conteúdo do Bruno = `setPlaylist` (~110 L), `setAmbiants` (~255 L), `setOneOffs` (~125 L), com 37 caminhos de som e acoplamento a `world.areas` (6 usos), `weather.*`, `dayCycles.events/intervalEvents`, `terrain.size`, `player.position`, `notifications`. Classe: **R parcial** (copiar só `register/groups/mute`). **Não faz parte do motor vazio** (o som de impacto de `Objects` está comentado). |
| C-12 | `Inputs/*` A | Confirmado A, com detalhes que mudam o esforço: (1) `Nipple.js` **não é DOM**: desenha o joystick como malha TSL **na cena 3D** e depende de `view`, `viewport`, `scene`, `Raycaster`; mudar para "metade esquerda" é R. (2) `Inputs.js` importa estaticamente os 6 submódulos e `InteractiveButtons` exige `.js-touch-buttons` com `.js-overlay` e `.js-button` no HTML. (3) `Wheel.js` usa `normalize-wheel` (BSD-3, sem manutenção): trocar por `event.deltaY`. (4) Os filtros de entrada mudam classes `input-filter-*` no `<html>`. |
| C-13 | `Physics/Physics.js` K "Upgrade para Rapier 0.21" | K confirmado, com riscos novos: (1) o **upstream não atualizou o Rapier por causa de um "sleep bug"** (mensagem do commit `70764a9`); testar sleep/wake do cubo dinâmico na 0.21 antes de confiar. (2) Passo **variável**: `world.timestep = ticker.deltaScaled` (`maxDelta` 1/30 × `scale` 2 = até 1/15 s), sem passo fixo nem interpolação; o `Time` fixa `ticker.scale = 2` e `gsap.globalTimeline.timeScale(2)`. O `CharacterController` (KCC) precisa decidir se segue isso ou usa passo fixo. (3) Colisores de cilindro vêm de filhos `tube*`, **não** `cylinder*` (corrige 0.2); suporta também `heightfield`. (4) `Physics` exige `game.water` (damping); `Objects` exige `view.focusPoint/optimalArea`, `water`, `materials.updateObject`. |
| C-14 | `Explosions.js, World/Confetti.js` A | `Explosions` lê `physicalVehicle.chassis`, `world.leaves`, `view.roll/focusPoint`, `time.bulletTime`, `objects.list`: acoplado ao veículo, "A" é otimista. `Confetti` lê `player.position` (3×). |
| C-15 | `Achievements.js, Map.js` A (Fase 4) | `Achievements` importa `data/achievements.js`, que importa `data/lab.js` e `data/projects.js` (conteúdo do Bruno), e usa `world.confetti/snow/rainLines`, `tornado`: na prática **R**. `Map.js` usa `ui/map/*.webp` (arte do Bruno), `modals`, `player.respawn`, `physicalVehicle.yRotation`. |
| C-16 | `utilities/*` K; `Geometries/PortalSlabsGeometry.js` "K se usado"; `Easter.js`, `BlackFriday/*` D | `utilities/ObservableMap.js` e `Easter.js`, `BlackFriday/BlackFriday.js` **não têm importadores** (código morto → D). `utilities/time.js` só é usado por `Achievements` e `CircuitArea` → D com eles. `PortalSlabsGeometry` só é usado por `BehindTheSceneArea` (D) → D. `WindLineGeometry` só por `WindLines`. |
| C-17 | `Game.js` A | Além do listado: `reset()` referencia `world.areas.bowling/cookie/toilet/social`, `explosiveCrates`, `benches`, `fences`, `bricks`, `lanterns`; carrega recursos **mortos** (`playgroundVisual/Physical` não são lidos em nenhum arquivo; `career*Texture` só pela `CareerArea`); usa `VITE_COMPRESSED`, `VITE_PLAYER_SPAWN`. O singleton obriga a ordem de construção (seção 3.3). Na prática é **reescrita guiada**, não adaptação. |
| C-18 | (não listado) `World/World.js`, `sources/index.js`, `sources/threejs-override.js` | Faltam em 6.3. `World.js` (245 L, 28 módulos) é substituído por um `World` mínimo. `threejs-override.js` faz **monkey patch global** de `THREE.Object3D.prototype.copy` (copia `animations` e clona filhos): `clone()` de GLTFs depende disso, então entra no motor. `index.js` instancia `Game` (e expõe `window.game` com `VITE_GAME_PUBLIC`). |

### 2.2 Correções à seção 0.2

| Item | Plano | Real |
|---|---|---|
| Colisores | `trimesh*`, `hull*`, `cuboid*`, `cylinder*`, `ball*` | `trimesh*`, `hull*`, `cuboid*`, **`tube*`** (cilindro), `ball*` (`Objects.getFromModel`). `Physics.getPhysical` também aceita `heightfield`. |
| Referências | `ref<Nome><n>` | Confirmado em `References.js` (`^ref(?:erence)?Nome[n]`). Respawns usam outro padrão (C-05). |
| Prioridades do `Ticker` | "0 → 3 → 7 → 10 → 14 → 998" | Corretas como marcos, mas há também 1, 2, 4, 5, 6, 8, 9, 13, 200, 1000, 2000 (C-01). |
| Extras de servidor | Server, Whispers, ... | Confirmado. `game.server` aparece em 8 arquivos (e `Game.js` instancia `Server`): `Easter`, `Options`, `Reveal` (`server.start()`), `Tornado`, `AltarArea`, `CircuitArea`, `CookieArea`, `Whispers`. **Nenhum está no fecho mínimo** salvo `Reveal` (a ser reduzido). |
| gtag | em `index.html` | Confirmado (linhas 45-51; id fixo `G-JMSN30BQ5J` na URL do script e `%VITE_ANALYTICS_TAG%`). Também há `<link>` para Google Fonts (Amatic SC, Nunito). |
| Fontes | Amatic SC e Nunito | O `index.html` usa essas duas via Google Fonts, mas `static/fonts/` contém ainda **Pally** (Bold/Medium/Regular/Variable em eot/ttf/woff/woff2), sem arquivo de licença na pasta (licença não verificada). |
| Deps | `package.json` "ISC" | Confirmado ("ISC" no `package.json`, MIT em `license.md`). `nodePolyfills()` no `vite.config.js` só serve ao `msgpack-lite` (servidor): fora do motor. |
| `Monitoring` | "stats-gl só com `?debug`" | Código morto (C-07). |

---

## 3. Fecho mínimo "motor vazio"

Alvo: boot de um mundo com chão + 1 cubo dinâmico, renderer (WebGPU com fallback WebGL2), física Rapier, entradas, câmera e debug. Sem áudio, sem servidor, sem Player, sem UI do menu.

### 3.1 Arquivos de `sources/Game/` (33 existentes, mantidos ou adaptados)

| Grupo | Arquivos |
|---|---|
| Laço e utilitários | `Events.js`, `Ticker.js`, `Time.js`, `Viewport.js`, `Quality.js`, `Debug.js`, `utilities/maths.js`, `utilities/ObservableSet.js` |
| Render e recursos | `Rendering.js`, `Passes/cheapDOF.js`, `ResourcesLoader.js` |
| Câmera | `View.js` |
| Entradas | `Inputs/Inputs.js`, `Inputs/Keyboard.js`, `Inputs/Pointer.js`, `Inputs/Wheel.js`, `Inputs/Gamepad.js`, `Inputs/InteractiveButtons.js`, `Inputs/Nipple.js` (pode virar stub no primeiro corte) |
| Física e objetos | `Physics/Physics.js`, `Objects.js`, `Physics/PhysicsWireframe.js` (só debug) |
| Material, luz e ambiente | `Materials.js`, `Materials/MeshDefaultMaterial.js`, `Ligthing.js`, `Fog.js`, `Water.js`, `Terrain.js`, `Tracks.js`, `Cycles/Cycles.js`, `Cycles/DayCycles.js` |
| Reduzidos | `Reveal.js` (só uniforms + `update`), `Respawns.js` (1 respawn em código) |

Novos (não existem no upstream como estão): `Game.js` adaptado (ordem em 3.3) e `World/World.js` mínimo (chão + cubo).

Fora de `sources/Game/`: `sources/index.js`, `sources/threejs-override.js`, um `index.html` reduzido com `.game`, `canvas.js-canvas` e `.js-touch-buttons` (`.js-overlay`, `.js-button`), CSS mínimo, `vite.config.js` com `vite-plugin-wasm` (Rapier não-compat).

Não entram (confirmado por leitura): `Audio`, `Player`, `Physics/PhysicsVehicle`, `World/VisualVehicle`, `Noises`, `Wind`, `Weather`, `Cycles/YearCycles`, `Explosions`, `Zones`, `InstancedGroup`, `References`, `PreRenderer`, `Monitoring`, `Materials/MeshGridMaterial` (remover o import morto de `Terrain`), `World/Floor`, `World/Grid`, `Overlay`, `RayCursor`, `InteractivePoints`, Menu/Modals/Notifications/Options/Tabs/Title/ClosingManager, Achievements/Map, Server e tudo de `World/**` exceto o `World` mínimo.

Totais: 35 arquivos "E" na tabela (33 + `Game.js` + `World/World.js`); 6 349 linhas, das quais 5 827 nos 33 reaproveitados.

### 3.2 Stubs e adaptações obrigatórias para o fecho fechar

1. **Reveal**: classe com `position2Uniform`, `distance` (valor alto, ex. 1e4), `thickness`, `color`, `intensity` e `update()` (cópia de `dayCycles.properties.revealColor/revealIntensity`). Sem `audio`, `world`, `menu`, `server`.
2. **Terrain**: `resources.terrainTexture` vem de `DataTexture` gerada em código (sem arquivo). `tracks.renderTarget` mantido.
3. **Respawns**: `Map` com `default` (`position`, `rotation`); `View` e `Reveal` só chamam `getDefault()`.
4. **DayCycles**: contrato de propriedades de C-09; progresso fixável para testes.
5. **ResourcesLoader**: sem `DRACOLoader` (`./draco/`) e sem `KTX2Loader` (`./basis/`); `MeshoptDecoder`; `detectSupport` só se KTX2 voltar.
6. **Debug**: `await` de import dinâmico antes de qualquer `new` (C-07); `Rendering` sem import estático do Inspector.
7. **View**: guarda para `rendering.cheapDOFPass` em tiers sem DOF; sem imports mortos (`Line2` webgpu).
8. **Material**: definir se `hasLightBounce` fica ligado (exige `Terrain`/`Tracks`) ou desligado por padrão.

### 3.3 Ordem de construção (derivada de `Game.init`)

`scene → Debug → ResourcesLoader → Quality → Ticker → Time → DayCycles → Inputs → Viewport → Rendering (await setRenderer) → carregar recursos próprios (paleta) → Respawns → View → Rendering.setPostprocessing/start → Reveal(mín.) → Tracks → Lighting → Fog → Water → Materials → Objects → World(mín.) → import('@dimforge/rapier3d') → Terrain → Physics (→ PhysicsWireframe) → cubo dinâmico via Objects/Physics`. Dependências circulares reais: `Rendering.setPostprocessing` precisa de `view.camera`; `Lighting` e `Fog` precisam de `view.optimalArea`; `Terrain` precisa de `tracks`; `Physics` precisa de `RAPIER` e `water`.

### 3.4 Assets referenciados pelo fecho mínimo

Nenhum, com os stubs acima. No upstream o mesmo fecho exigiria `palette.png|ktx`, `respawns/respawnsReferences.glb`, `terrain/terrain.png`, `basis/` e `draco/` (os dois últimos são cópias de bibliotecas do `three`).

---

## 4. Achados surpreendentes

1. **Licenças (fora de `sources/Game/`)**
   - Código: MIT, "Copyright (c) 2025 Bruno Simon" (`license.md`). `package.json` diz ISC.
   - `static/sounds/musics/license.md`: CC0 1.0 (músicas de Kounine; o site diz que são CC0).
   - `static/sounds/**` (151 MB de fonte): os 37 caminhos de `Audio.js` têm nomes de bibliotecas comerciais (Mountain Audio, "Robotic_Lifeforms", "Source ...", "ComedyCrash", "Cash Register"...) e **não há arquivo de licença** além do das músicas. Não cobertos pela MIT de forma evidente.
   - `static/basis/` e `static/draco/`: cópias de decoders de terceiros (Basis Universal e Draco, Apache-2.0 nos projetos de origem) com `README.md` apenas, sem LICENSE. Plano já usa as do pacote `three`.
   - `static/fonts/`: **Pally** (4 pesos × 4 formatos), sem licença local.
   - `resources/` (152 MB): `.blend`, `.psd`, `bruno.glb`/`bruno-sudo.blend` (modelo com a figura do autor), texturas de marca (`circuitBrand.png`, logos). Nunca copiar.
   - Código em `sources/`: nenhum cabeçalho de copyright/licença embutido. `Noises.js` tem `hash/voronoi` no estilo de transpilação GLSL→TSL (`Fn(...).setLayout`) sem atribuição: tratar como de origem incerta e reescrever em vez de copiar se for usado.
   - Dependência de runtime: `normalize-wheel` (BSD-3-Clause, Facebook).
2. **Caminhos só-WebGPU ou com risco no fallback WebGL2**: `World/Leaves.js` usa `renderer.computeAsync` (compute TSL; WebGL2 não garantido); `Game.js:203` só roda `PreRenderer` com `backend.isWebGPUBackend`; `Options.js:66` só exibe o backend; `Rendering.js` fixa `forceWebGL:false`; `Tornado` e `View` (import morto) usam `three/examples/jsm/lines/webgpu/Line2.js`. O `RenderPipeline` com `BloomNode` é portátil. `RainLines` tem o `computeAsync` comentado. O motor vazio não usa nenhum deles.
3. **Servidor**: só `Reveal.updateStep(2)` chama `game.server.start()` no caminho de boot; tudo o mais é conteúdo/UI descartável. Sem `Server`, `Options` quebra (`game.server.connected` e `events.on`), então `Options` precisa ser reescrito junto.
4. **Passo de física variável e tempo em dobro** (C-13): afeta o `CharacterController`.
5. **Rapier**: upstream parou em 0.19.x por um "sleep bug"; o plano sobe para 0.21 (C-13).
6. **Prioridade fracionária no `Ticker`** (C-01): bug latente no plano 6.4.
7. **`Tracks` renderiza 512×512 todo tick** mesmo sem trilhas; custo fixo no motor vazio.
8. **Desacoplamento bom**: `View` não referencia `Player` (o `Player` empurra `view.focusPoint.trackedPosition`); dá para testar a câmera sem veículo.
9. **Recursos mortos** em `Game.js` (`playground*`, texturas `career*`) e imports mortos (`Monitoring`, `Line2` em `View`, `MeshGridMaterial` em `Terrain`).

---

## 5. Inventário por arquivo (118)

Colunas: arquivo, linhas, imports locais (sem `Game.js`), imports externos (sem `three/webgpu`/`three/tsl`), importado por, nº de usos de `game.server`, `resources.*`, assets de `static/` citados no código, classe no plano, presença no motor vazio (E = entra, E\* = entra reduzido/novo, `-` = fora), veredito, nota. Importadores listam até 5 nomes e **omitem `Game.js`**, que importa 47 módulos (um "-" significa que só `Game.js` importa o arquivo, ou ninguém). As notas da tabela foram geradas sem alguns acentos; a prosa acima é a referência.

| Arquivo (`sources/Game/…`) | L | Imports locais | Externos | Importado por | `server` | `resources.*` | `static/` | Plano | Motor vazio | Veredito | Nota |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `Achievements.js` | 631 | data/achievements, utilities/time, Events | - | - | - | - | 2 sons | A (Fase 4) | - | CORR | Importa dados do Bruno (achievements -> lab, projects); na prática R. |
| `Audio.js` | 770 | utilities/maths, Events | howler, gsap | - | - | - | 37 sons; Sudo.mp3; Boy.mp3 +1 | A | - | CORR | Só ~200 L são engine; setPlaylist/setAmbiants/setOneOffs (~490 L) são conteúdo acoplado (C-11). |
| `BlackFriday/BlackFriday.js` | 252 | BlackFriday/FragmentObject | - | - | - | fragments | - | D | - | OK | Sem importadores. |
| `BlackFriday/FragmentObject.js` | 95 | - | gsap, seedrandom | BlackFriday/BlackFriday | - | fragment | - | D | - | OK |  |
| `ClosingManager.js` | 110 | Inputs/Inputs, Menu, Modals, World/Areas/CircuitArea, World/Areas/LabArea, World/Areas/ProjectsArea | - | - | - | - | - | R | - | OK | Cita 6 áreas do Bruno. |
| `Cycles/Cycles.js` | 312 | utilities/maths, Events | gsap | Cycles/DayCycles, Cycles/YearCycles | - | - | - | A | E | OK* | Relógio real (`Date.now()`); `debug.addManualBinding` sempre chamado. |
| `Cycles/DayCycles.js` | 71 | Cycles/Cycles | - | - | - | - | - | A | E | OK* | Contrato de propriedades em C-09. |
| `Cycles/YearCycles.js` | 30 | Cycles/Cycles | - | - | - | - | - | D | - | CORR | Weather e Leaves leem `yearCycles.properties.{humidity,leaves,temperature}`. |
| `Debug.js` | 91 | - | tweakpane, @tweakpane/plugin-essentials, @tweakpane/plugin-camerakit | - | - | - | - | K | E | CORR | Import dinâmico viável só com `await` no inicio de `Game.init` (C-07). |
| `Easter.js` | 170 | - | - | - | 1 | - | - | D | - | OK | Sem importadores. |
| `Events.js` | 65 | - | - | Achievements, Audio, Cycles/Cycles, Explosions, InputFlag +16 | - | - | - | K | E | OK* | Prioridade via `for...in` de array: só inteiros ordenam; `5.5` roda por último (C-01). |
| `Explosions.js` | 82 | Events, utilities/maths | - | - | - | - | - | A | - | OK* | Acoplado a physicalVehicle, world.leaves, view.roll, time.bulletTime. |
| `Fog.js` | 50 | - | - | - | - | - | - | K/A | E | OK | Usa `dayCycles.properties.fog*`, `view.optimalArea`; define `scene.backgroundNode`. |
| `Game.js` | 277 | Debug, Inputs/Inputs, Physics/Physics, Rendering, ResourcesLoader, Ticker, Time, Player, View, Viewport, World/World, Tracks, Ligthing, Materials, Objects, Fog, Cycles/DayCycles, Weather, Noises, Wind, Terrain, Explosions, Cycles/YearCycles, Server, Modals, Physics/PhysicsVehicle, Physics/PhysicsWireframe, Zones, Overlay, Tornado, InteractivePoints, Respawns, Audio, ClosingManager, RayCursor, Water, Reveal, KonamiCode, Achievements, Notifications, Quality, Menu, Title, PreRenderer, Options, Map | gsap, @dimforge/rapier3d | - | - | - | - | A | E* | CORR | Reescrever. 47 imports; `reset()` cita áreas/benches/fences/bricks/lanterns/explosiveCrates; carrega `playground*` e `career*` (mortos); `VITE_COMPRESSED`/`VITE_PLAYER_SPAWN`. |
| `Geometries/LineGeometry.js` | 70 | - | - | Geometries/WindLineGeometry, World/Lightnings | - | - | - | K | - | OK |  |
| `Geometries/PortalSlabsGeometry.js` | 173 | - | - | World/Areas/BehindTheSceneArea | - | - | - | K se usado | - | CORR | Só BehindTheSceneArea usa: D. |
| `Geometries/WindLineGeometry.js` | 37 | Geometries/LineGeometry | - | World/WindLines | - | - | - | K se usado | - | OK | Só WindLines. |
| `InputFlag.js` | 217 | data/countries, Events | - | World/Areas/CircuitArea, World/Whispers | - | - | ui/flags/${_country[2]}.webp | D | - | OK | Só Circuit/Whispers. |
| `Inputs/Gamepad.js` | 438 | Events, utilities/maths | - | Inputs/Inputs | - | - | - | A | E | OK |  |
| `Inputs/Inputs.js` | 334 | Events, Inputs/Gamepad, Inputs/Pointer, Inputs/Keyboard, Inputs/InteractiveButtons, Inputs/Wheel, Inputs/Nipple, utilities/ObservableSet | - | ClosingManager, Inputs/Nipple, InteractivePoints, Menu, Player +5 | - | - | - | A | E | OK* | Importa estático os 6 submódulos; DOM `.js-touch-buttons`. |
| `Inputs/InteractiveButtons.js` | 115 | Events | - | Inputs/Inputs | - | - | - | A | E | OK | Exige `.js-touch-buttons`/`.js-overlay`/`.js-button` no HTML. |
| `Inputs/Keyboard.js` | 49 | Events | - | Inputs/Inputs | - | - | - | A | E | OK |  |
| `Inputs/Nipple.js` | 279 | utilities/maths, Events, Inputs/Inputs | three/src/math/MathUtils.js, gsap | Inputs/Inputs | - | - | - | A | E (pode virar stub) | OK* | Joystick desenhado **na cena 3D** (TSL), não DOM; usa view/viewport/scene. |
| `Inputs/Pointer.js` | 196 | Events | - | Inputs/Inputs, View | - | - | - | A | E | OK | View importa `Pointer.MODE_*`. |
| `Inputs/Wheel.js` | 17 | Events | normalize-wheel | Inputs/Inputs | - | - | - | A | E | OK | Pacote `normalize-wheel` (BSD-3, sem manutenção). |
| `InstancedGroup.js` | 120 | - | - | World/Areas/BowlingArea, World/Areas/CookieArea, World/Areas/SocialArea, World/Benches, World/Bricks +4 | - | - | - | K | - | OK |  |
| `InteractivePoints.js` | 664 | Inputs/Inputs | gsap | World/Areas/AchievementsArea, World/Areas/BehindTheSceneArea, World/Areas/BowlingArea, World/Areas/CircuitArea, World/Areas/CookieArea +6 | - | interactivePointsKeyIconEnterTexture, interactivePointsKeyIconCrossTexture, interactivePointsKeyIconATexture | 2 sons | A | - | OK* | 3 texturas de ícone (arte do Bruno), fog, rayCursor, audio, player. |
| `KonamiCode.js` | 78 | World/VisualVehicle | - | - | - | vehicle | vehicle/oldSchool.glb; vehicle/default.glb | D | - | OK |  |
| `Ligthing.js` | 215 | - | - | - | - | - | - | A | E | OK* | Usa `dayCycles.progress` + `properties.lightColor/lightIntensity`, `view.optimalArea`; shadow 2048/512. |
| `Map.js` | 193 | - | three/src/math/MathUtils.js | - | - | - | ui/map/map-night.webp; ui/map/map-day.webp | A (Fase 4) | - | OK | Usa `ui/map/*.webp` (arte do Bruno), modals, player. |
| `Materials.js` | 367 | Materials/MeshDefaultMaterial | - | - | - | paletteTexture | - | A | E | OK | Só exige `resources.paletteTexture` (nossa). `updateObject`/`getFromName` usados por Objects. |
| `Materials/MeshDefaultMaterial.js` | 136 | - | - | Materials, World/Areas/AchievementsArea, World/Areas/CircuitArea, World/Areas/CookieArea, World/Areas/LabArea +16 | - | - | - | A | E | CORR | Exige lighting, fog, water, terrain e reveal (C-02/C-03). |
| `Materials/MeshGridMaterial.js` | 157 | - | - | Terrain, World/Grid | - | - | - | K debug | - | OK | Terrain importa sem usar (linha 3): remover import. |
| `Menu.js` | 285 | Events, Inputs/Inputs, Tabs, World/Areas/CircuitArea | - | ClosingManager | - | - | - | R | - | OK | Importa CircuitArea. |
| `Modals.js` | 205 | Events, Tabs | - | ClosingManager | - | - | - | R | - | OK |  |
| `Monitoring.js` | 39 | - | stats-gl | - | - | - | - | K | - | CORR | Codigo morto: import e `new` comentados em Game.js. D (stats ja existe em Rendering por `#stats`). |
| `Noises.js` | 293 | - | - | - | - | - | - | K | - | OK* | Fora do mínimo, mas pré-requisito de Wind/Grass/Floor/Leaves/WaterSurface/Overlay (perlin/voronoi/hash, 40+ usos). Renderiza em RT na inicialização. |
| `Notifications.js` | 176 | - | - | - | - | - | - | R | - | OK |  |
| `Objects.js` | 365 | - | - | - | - | - | - | K | E | OK | Exige view (focusPoint, optimalArea), water, materials, physics. `getFromModel`: prefixo de cilindro é `tube`, não `cylinder`. |
| `Options.js` | 118 | - | - | - | 3 | - | - | R | - | OK | Usa `game.server` (3x). |
| `Overlay.js` | 143 | - | gsap | - | - | overlayPatternTexture | 2 sons | R | - | OK | Usa `noises` e `resources.overlayPatternTexture`. |
| `Passes/cheapDOF.js` | 57 | - | three/examples/jsm/tsl/display/hashBlur.js | Rendering | - | - | - | K Q0 | E | OK | `three/examples/jsm/tsl/display/hashBlur.js`. |
| `Physics/Physics.js` | 315 | - | - | - | - | - | - | K | E | OK* | Passo variável `ticker.deltaScaled` (até 1/15 s); exige `water`; colisores trimesh/hull/cuboid/tube/ball/heightfield. |
| `Physics/PhysicsVehicle.js` | 591 | Events, utilities/maths | - | - | - | - | - | K quarentena | - | OK | Usa `player.*` e `world.waterSurface`. |
| `Physics/PhysicsWireframe.js` | 59 | - | - | - | - | - | - | K | E (debug) | OK |  |
| `Player.js` | 677 | utilities/maths, Inputs/Inputs | gsap, three/src/math/MathUtils.js | World/Areas/CircuitArea | - | - | 9 sons | R | - | OK | Usa inputs(60), physicalVehicle(29), achievements, audio, overlay, tracks, dayCycles; View não o referencia. |
| `PreRenderer.js` | 35 | - | three/src/renderers/common/CubeRenderTarget.js | - | - | - | - | K | - | CORR | Deep import `three/src/renderers/common/CubeRenderTarget.js` (2ª cópia de classe vs `three/webgpu`). A. |
| `Quality.js` | 49 | Events | - | - | - | - | - | A | E | OK* | `level` lido como booleano em ~15 pontos (C-08). |
| `RayCursor.js` | 220 | - | - | - | - | - | - | A | - | OK |  |
| `References.js` | 51 | - | - | World/Areas/Area, World/Scenery | - | - | - | K | - | OK | Regex confirmada. |
| `Rendering.js` | 185 | Passes/cheapDOF | three/addons/tsl/display/BloomNode.js, three/addons/inspector/Inspector.js | - | - | - | - | A | E | OK* | Importa estático `three/addons/inspector/Inspector.js` (só `#inspector`); `forceWebGL:false` fixo; `qualityChange` só trata niveis 0/1; DOF sempre construido. |
| `ResourcesLoader.js` | 124 | - | three/addons/loaders/GLTFLoader.js, three/addons/loaders/DRACOLoader.js, three/addons/loaders/KTX2Loader.js | - | - | - | - | A | E | OK* | `gltf` instancia sempre Draco (`./draco/`, `preload()`) e KTX2 (`./basis/`, `detectSupport(renderer)`); rejeita no 1º erro; progresso por contagem. |
| `Respawns.js` | 68 | - | - | - | - | respawnsReferencesModel | - | K | E* | CORR | Lê `resources.respawnsReferencesModel` (glb do Bruno) no construtor; nomes `respawn<Nome>`, y fixo 4 (C-05). |
| `Reveal.js` | 237 | - | gsap | - | 1 | - | 1 sons | R | E* | CORR | Minimo = só uniforms (C-03). |
| `Server.js` | 133 | Events | msgpack-lite, uuid | - | - | - | - | D | - | OK | WebSocket + msgpack-lite + uuid. |
| `Tabs.js` | 106 | - | - | Menu, Modals | - | - | - | R | - | OK |  |
| `Terrain.js` | 133 | Materials/MeshGridMaterial | - | - | - | terrainTexture | - | A | E | CORR | No fecho mínimo (light bounce); exige `resources.terrainTexture` (arte do Bruno) e `tracks` (C-02). |
| `TextCanvas.js` | 113 | - | - | World/Areas/LabArea, World/Areas/ProjectsArea | - | - | - | K | - | OK | Sem dependência de Game. |
| `Ticker.js` | 72 | Events | gsap | - | - | - | - | K | E | OK | Tick acionado por `renderer.setAnimationLoop`; `scale=2`. |
| `Time.js` | 85 | utilities/maths | gsap | - | - | - | - | K | E | OK | Mexe em `gsap.globalTimeline.timeScale(2)` e `ticker.scale`. |
| `Title.js` | 105 | - | - | - | - | - | - | R | - | OK | Usa `physicalVehicle.forwardSpeed`. |
| `Tornado.js` | 256 | utilities/maths | three/addons/lines/LineGeometry.js, three/addons/lines/webgpu/Line2.js, gsap | - | 3 | tornadoPathReferencesModel | - | D | - | OK | `game.server`. |
| `Tracks.js` | 251 | - | - | World/VisualVehicle | - | - | - | A | E | CORR | No fecho mínimo via Terrain; renderiza RT 512x512 por tick. |
| `Trails.js` | 184 | - | - | World/VisualVehicle | - | - | - | A | - | OK | Só VisualVehicle usa; usa `materials.gradientTexture`. |
| `View.js` | 789 | utilities/maths, Inputs/Pointer, Inputs/Inputs | camera-controls, gsap, seedrandom, three/examples/jsm/lines/LineGeometry.js, three/examples/jsm/lines/webgpu/Line2.js | World/Areas/SocialArea | - | - | - | A | E | OK* | Não referencia Player (bom). Usa respawns, `rendering.cheapDOFPass`, inputs, quality. Imports mortos: `Line2` webgpu; `LineGeometry` jsm só no debug. |
| `Viewport.js` | 49 | Events | - | - | - | - | - | K | E | OK | Lê `.game` do DOM. |
| `Water.js` | 27 | - | - | - | - | - | - | K/A | E | OK | Só uniforms (27 L); Physics e Objects usam. |
| `Weather.js` | 230 | utilities/maths | gsap | - | - | - | - | D | - | CORR | Referenciado por Wind, WindLines, WaterSurface, Audio: D só com cirurgia nesses. |
| `Wind.js` | 78 | utilities/maths | - | - | - | - | - | K/A | - | CORR | Depende de `game.weather.wind` (Weather é D) e `noises`. A obrigatório (C-01b). |
| `World/Areas/AchievementsArea.js` | 349 | InteractivePoints, Materials/MeshDefaultMaterial, World/Areas/Area | seedrandom | World/Areas/Areas | - | achievementsGlyphsTexture | 1 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/AltarArea.js` | 517 | World/Areas/Area | gsap, seedrandom | World/Areas/Areas | 7 | satanStarTexture, achievementsGlyphsTexture | 3 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/Area.js` | 178 | Events, References, utilities/maths | - | World/Areas/AchievementsArea, World/Areas/AltarArea, World/Areas/BehindTheSceneArea, World/Areas/BowlingArea, World/Areas/CareerArea +9 | - | - | - | K/A | - | OK | Usa zones, References, `objects.addFromModel`. |
| `World/Areas/Areas.js` | 82 | World/Areas/AltarArea, World/Areas/CookieArea, World/Areas/LandingArea, World/Areas/ProjectsArea, World/Areas/LabArea, World/Areas/CareerArea, World/Areas/SocialArea, World/Areas/ToiletArea, World/Areas/BowlingArea, World/Areas/CircuitArea, World/Areas/BehindTheSceneArea, World/Areas/AchievementsArea, World/Areas/TimeMachineArea, World/Areas/EasterArea | - | World/World | - | áreasModel | - | K/A | - | OK | Lista fixa de 14 áreas + `resources.áreasModel`. |
| `World/Areas/BehindTheSceneArea.js` | 168 | Geometries/PortalSlabsGeometry, InteractivePoints, World/Areas/Area | - | World/Areas/Areas | - | behindTheSceneStarsTexture | 1 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/BowlingArea.js` | 645 | InteractivePoints, utilities/maths, InstancedGroup, World/Areas/Area | gsap | World/Areas/Areas | - | jukeboxMusicNotes | 2 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/CareerArea.js` | 376 | World/Areas/Area | gsap, three/src/math/MathUtils.js | World/Areas/Areas | - | - | 2 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/CircuitArea.js` | 1691 | utilities/maths, InteractivePoints, Player, Materials/MeshDefaultMaterial, InputFlag, World/Areas/Area, utilities/time | gsap, seedrandom | ClosingManager, Menu, World/Areas/Areas | 12 | - | 5 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/CookieArea.js` | 529 | InstancedGroup, InteractivePoints, Materials/MeshDefaultMaterial, World/Areas/Area | gsap, seedrandom | World/Areas/Areas | 6 | - | 1 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/EasterArea.js` | 38 | InteractivePoints, World/Areas/Area | - | World/Areas/Areas | - | - | - | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/LabArea.js` | 1459 | InteractivePoints, data/lab, TextCanvas, utilities/maths, Inputs/Inputs, Materials/MeshDefaultMaterial, World/Areas/Area | gsap | ClosingManager, World/Areas/Areas | - | get, set | 1 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/LandingArea.js` | 273 | Inputs/Inputs, InteractivePoints, World/Areas/Area, Materials/MeshDefaultMaterial | gsap | World/Areas/Areas | - | - | - | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/ProjectsArea.js` | 1556 | InteractivePoints, data/projects, TextCanvas, Inputs/Inputs, Materials/MeshDefaultMaterial, World/Areas/Area | gsap | ClosingManager, World/Areas/Areas | - | get, set | 1 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/SocialArea.js` | 318 | InteractivePoints, data/social, InstancedGroup, World/Areas/Area, View | - | World/Areas/Areas | - | - | - | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/TimeMachineArea.js` | 118 | InteractivePoints, World/Areas/Area | gsap | World/Areas/Areas | - | timeMachineScreenFolioTexture, timeMachineScreenMGSTexture | 1 sons | D | - | OK | Conteúdo do Bruno. |
| `World/Areas/ToiletArea.js` | 55 | World/Areas/Area | - | World/Areas/Areas | - | - | - | D | - | OK | Conteúdo do Bruno. |
| `World/Benches.js` | 64 | InstancedGroup | - | World/World | - | benchesModel | - | D/R | - | OK |  |
| `World/Bricks.js` | 65 | InstancedGroup | - | World/World | - | bricksModel | - | D/R | - | OK |  |
| `World/Bubble.js` | 284 | - | gsap | World/Whispers | - | - | - | D | - | OK |  |
| `World/Bushes.js` | 28 | World/Foliage | - | World/World | - | bushesReferences | - | A | - | OK |  |
| `World/Confetti.js` | 184 | Materials/MeshDefaultMaterial | gsap | World/World | - | - | - | A | - | OK | Usa `player.position`. |
| `World/ExplosiveCrates.js` | 190 | InstancedGroup | gsap | World/World | - | explosiveCratesModel | 3 sons | D/R | - | OK |  |
| `World/Fences.js` | 67 | InstancedGroup | - | World/World | - | fencesModel | - | D/R | - | OK |  |
| `World/Fireballs.js` | 108 | - | gsap | World/World | - | - | - | D | - | OK |  |
| `World/Floor.js` | 210 | Materials/MeshDefaultMaterial | - | World/World | - | terrainModel, floorSlabsTexture | - | A | - | OK | Exige `terrainModel`, `floorSlabsTexture` (arte do Bruno), noises, terrain. |
| `World/Flowers.js` | 178 | utilities/maths, Materials/MeshDefaultMaterial | three/examples/jsm/utils/BufferGeometryUtils.js, seedrandom | World/World | - | flowersReferencesModel | - | A | - | OK |  |
| `World/Foliage.js` | 220 | Materials/MeshDefaultMaterial | seedrandom, three/addons/utils/BufferGeometryUtils.js | World/Bushes, World/Trees | - | foliageTexture | - | A | - | OK | Exige `foliageTexture` (SDF), wind, lighting, `world.visualVehicle`. |
| `World/Grass.js` | 211 | Materials/MeshDefaultMaterial | - | World/World | - | - | - | A | - | OK | Usa wind.offsetNode, terrain, noises. |
| `World/Grid.js` | 102 | Materials/MeshGridMaterial, Materials/MeshDefaultMaterial | - | World/World | - | - | - | K debug | - | OK | Usa reveal e respawns no construtor. |
| `World/Intro.js` | 343 | Inputs/Inputs | gsap | World/World | - | soundTexture | intro/${name}Label.ktx | R | - | OK | Carrega `intro/*Label.ktx`. |
| `World/Lanterns.js` | 70 | InstancedGroup | - | World/World | - | lanternsModel | - | D | - | OK |  |
| `World/Leaves.js` | 306 | utilities/maths, Materials/MeshDefaultMaterial | gsap | World/World | - | - | - | A | - | OK* | **`computeAsync`** (compute): fallback WebGL2 não garantido; usa yearCycles, tornado, physicalVehicle. |
| `World/Lightnings.js` | 493 | Geometries/LineGeometry, utilities/maths | gsap, seedrandom | World/World | - | - | 5 sons | D | - | OK |  |
| `World/PoleLights.js` | 142 | InstancedGroup | gsap | World/World | - | poleLightsModel | - | D | - | OK |  |
| `World/RainLines.js` | 258 | Materials/MeshDefaultMaterial, utilities/maths | - | World/World | - | - | - | D | - | OK |  |
| `World/Scenery.js` | 119 | References, Materials/MeshDefaultMaterial | - | World/World | - | sceneryModel | - | D | - | OK |  |
| `World/Snow.js` | 476 | utilities/maths, Materials/MeshDefaultMaterial | - | World/World | - | - | - | D | - | OK |  |
| `World/Trees.js` | 121 | World/Foliage | - | World/World | - | - | - | A | - | OK |  |
| `World/VisualTornado.js` | 171 | - | - | World/World | - | - | - | D | - | OK |  |
| `World/VisualVehicle.js` | 547 | Tracks, Trails, utilities/maths, Materials/MeshDefaultMaterial | three/src/math/MathUtils.js, gsap | KonamiCode, World/World | - | behindTheSceneStarsTexture, vehicle | - | K quarentena | - | OK |  |
| `World/WaterSurface.js` | 468 | utilities/maths, Materials/MeshDefaultMaterial | three/examples/jsm/tsl/display/hashBlur.js, three/examples/jsm/tsl/display/boxBlur.js | World/World | - | - | - | K/A | - | OK* | Usa weather, noises, quality, `objects.enable/disable`. |
| `World/Whispers.js` | 529 | World/Bubble, InputFlag | gsap, emoji-regex | World/World | 8 | whisperFlameTexture | 2 sons | D | - | OK | `game.server`; `emoji-regex`. |
| `World/WindLines.js` | 192 | Geometries/WindLineGeometry, utilities/maths, Materials/MeshDefaultMaterial | gsap | World/World | - | - | - | A | - | OK* | Usa weather.wind. |
| `World/World.js` | 245 | World/Floor, World/Grid, World/Grass, World/WaterSurface, World/Areas/Areas, World/WindLines, World/Leaves, World/Lightnings, World/Snow, World/Whispers, World/VisualVehicle, World/VisualTornado, World/Flowers, World/Bricks, World/Trees, World/Bushes, Materials/MeshDefaultMaterial, World/Fireballs, World/ExplosiveCrates, World/RainLines, World/Confetti, World/Intro, World/PoleLights, World/Lanterns, World/Fences, World/Benches, World/Scenery | - | - | - | vehicle, birchTreesVisualModel, birchTreesReferencesModel, oakTreesVisualModel +4 | - | (não listado) | E* | CORR | Ausente de 6.3. Novo `World` mínimo (chão + cubo) substitui; o original carrega 28 modulos. |
| `Zones.js` | 82 | Events | - | - | - | - | - | K | - | CORR | Lê `game.player.position`: A trivial. |
| `utilities/ObservableMap.js` | 28 | - | - | - | - | - | - | K | - | CORR | Sem importadores: código morto, D. |
| `utilities/ObservableSet.js` | 42 | - | - | Inputs/Inputs | - | - | - | K | E | OK | Só Inputs usa. |
| `utilities/maths.js` | 185 | - | - | Audio, Cycles/Cycles, Explosions, Inputs/Gamepad, Inputs/Nipple +19 | - | - | - | K | E | OK |  |
| `utilities/time.js` | 29 | - | - | Achievements, World/Areas/CircuitArea | - | - | - | K | - | CORR | Só Achievements e CircuitArea usam: D com eles. |

---

## 6. Reprodução

- Clone: `git clone https://github.com/brunosimon/folio-2025.git D:\GitHub\_vendorolio-2025` e `git -C D:\GitHub\_vendorolio-2025 checkout 70764a9`.
- Importadores/imports: varredura por regex de `import ... from` e `import()` em `sources/Game/**`, ignorando linhas iniciadas por `//`.
- Teste de prioridade: `const e=[];e[3]=["p"];e[5.5]=["c"];e[7]=["v"];e[998]=["r"];for(const k in e)console.log(k)` imprime `3 7 998 5.5`.
