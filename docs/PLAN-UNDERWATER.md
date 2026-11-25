# Plano Técnico — Iteração Fase 7: Passagem Oceânica & Mapa Underwater

- **Projeto:** `C:\dev\voaneves\timeline\game` (Three.js WebGPU / TSL + Rapier3D)
- **Pré-requisito concluído na Fase 5:** Baía Oceânica Aberta no Sudoeste (`X: -92..-62, Z: +48..+92`), marcada discretamente no `map-day` / `map-night` em `(-78, 0, +68)` com um anel turquesa pontilhado.
- **Direção criativa:** *Abismo Luminoso & Recife Vivo* — zero elementos sombrios/ocultistas; atmosfera marinha serena, luminosa e exploratória (raios de sol atravessando a superfície, cáusticas turquesa/douradas, corais coloridos, cardumes, algas ondulantes e cápsulas submersas de arquitetura/dados).

---

## 1. Conceito & Loop do Jogador

1. **Na Superfície (Baía Sudoeste `(-78, 0, +68)`):**
   - Um **Portal de Mergulho / Boia Luminosa** flutua no mar aberto, com anéis de bolhas ascendentes, feixe suave de luz solar entrando na água e um `InteractivePoint` (`"Mergulhar · Mapa Subaquático"` / `"Dive · Underwater Map"`).
   - O jogador pode dirigir pelo raso da praia Oeste/Sul até a boia (ou usar um atalho de teleporte/marcador no Mapa após descobrir a Passagem).
2. **Transição Subaquática (`TransitionManager`):**
   - Ao ativar a passagem (`Enter` / botão `Interagir`):
     1. Efeito de imersão suave (`Reveal` radial invertido + cortina de bolhas + filtro passa-baixa de áudio subaquático com som de mergulho).
     2. O motor alterna o contexto de mundo ativo (`SurfaceWorld` ↔ `UnderwaterWorld`) sem recarregar a página e sem perder estado/conquistas.
     3. O veículo ativa o **Kit Anfíbio / Submarino**: domo transparente celeste sobre a cabine, turbinas hidro laterais com trilhas de bolhas no lugar de poeira e física de flutuação suave (`gravityScale = 0.22` + arrasto hidrodinâmico + empuxo vertical controlado por `Espaço` / `Shift`).
3. **No Mapa Underwater (`192 × 192 m`, profundidade `Y: -18m .. 0m`):**
   - **Santuário do Recife (Spawn Subaquático):** cúpula de vidro e mármore iluminada por raios de sol vindos da superfície e um **Farol de Retorno à Superfície** para voltar à ilha a qualquer momento.
   - **3 Zonas Temáticas Submersas:**
     1. **Jardim de Algas & Corais (Oeste):** floresta de *kelp* usando a mesma arquitetura world-locked GPU de `Grass.js`, reagindo às correntes marinhas e abrindo caminho quando o submarino passa.
     2. **Cápsulas de Dados & Arquitetura (Norte):** 4 esferas geodésicas translúcidas submersas com painéis holográficos destacando marcos de engenharia, dados e IA/RL.
     3. **Circuito de Argolas Submarino (Leste/Sul):** 8 anéis luminosos subaquáticos em slalom 3D (incluindo variação de altitude `Y`!) com cronômetro local em `localStorage` (`vn_uw_circuit_v1`).

---

## 2. Arquitetura Técnica & Mudanças no Motor (`game/sources/`)

| Módulo | Responsabilidade | Mudança planejada |
|---|---|---|
| `Game/WorldManager.js` *(novo)* | Orquestra `activeRealm` (`'surface' \| 'underwater'`) | Desabilita colisores/visuais do reino inativo (`setEnabled(false)` / `group.visible = false`) mantendo instâncias prontas para troca instantânea (< 50 ms). |
| `Game/World/OceanPassage.js` *(novo)* | Portal na Baía SW `(-78, 0, +68)` | Boia animada + anel de correnteza + `InteractivePoint` que dispara `worldManager.enterUnderwater()`. |
| `Game/World/Underwater/UnderwaterWorld.js` *(novo)* | Cena 3D subaquática (`Group` dedicado) | Terreno arenoso com dunas/fendas submarinas (`heightfield` Rapier dedicado), corais instanciados, rochas e farol de retorno. |
| `Game/World/Underwater/UnderwaterAtmosphere.js` *(novo)* | Iluminação, névoa e pós-processamento | `DayCycles` override submerso (névoa turquesa→índigo `#0d5c75 → #061c36`), **cáusticas TSL** projetadas sobre todo o solo e **God Rays** descendo da superfície. |
| `Game/World/Underwater/KelpForest.js` *(novo)* | Algas altas ondulantes em GPU | Reaproveita o padrão `worldCell` hash de `Grass.js` (zero jitter) com lâminas altas (`2.5–4.5 m`) e flexão em `S` por corrente marinha + desvio do veículo. |
| `Game/World/Underwater/MarineLife.js` *(novo)* | Cardumes e bolhas | 1 `InstancedMesh` de peixes estilizados nadando em órbita boids simples + sistema de bolhas ascendentes (`SpriteNodeMaterial`). |
| `Game/Physics/PhysicsVehicle.js` | Modo Submarino | Adiciona `setMode('car' \| 'submarine')`: ajusta `linearDamping`, `angularDamping`, `gravityScale`, propulsão 3D suave (`Espaço` sobe, `Ctrl/B` afunda) e mantém controles familiares. |
| `Game/World/VisualVehicle.js` | Visual Anfíbio | Alterna visibilidade de `amphibiousDome` + `hydroJets` (opcionais no `default.glb`) e muda `Trails` para bolhas ciano submersas. |
| `Game/Audio.js` | Ambiência Submersa | Aplica filtro `BiquadFilterNode` lowpass (`~650 Hz`) na música ambiente durante o mergulho + camada sutil de bolhas/correnteza. |

---

## 3. Shaders TSL Planejados

1. **Cáusticas no Fundo do Mar (`CausticsNode`):**
   - Duas amostras de `this.game.noises.voronoi` deslizando em direções opostas sobre `positionWorld.xz * 0.12`, combinadas por `min(v1, v2).pow(3.0)` e moduladas pela profundidade (`smoothstep(-16, -1, positionWorld.y)`), somando brilho ciano-dourado `#68e1fd` nas cristas.
2. **Raios de Sol Submersos (God Rays):**
   - Cones inclinados (`AdditiveBlending`, `depthWrite: false`) reaproveitando a técnica do `HeavenlySky.js`, com cintilação vinculada às ondas da superfície.
3. **Algas (`KelpForest.js`):**
   - Mesma base de `Grass.js` (zero `DoubleSide` normal inversion, `hasCoreShadows: false`, hash travado no mundo), com 5 segmentos verticais e onda senoidal dupla subindo da raiz até a ponta.

---

## 4. Roadmap Granular (`T7.0` a `T7.5`)

| Tarefa | Escopo | Critério de Pronto (DoD) |
|---|---|---|
| **`T7.0`** | **Refatorar `World` → `WorldManager` + Passagem Oceânica SW** | Entrar no portal em `(-78, 0, +68)` executa transição sem erros de memória ou Rapier; retorno à superfície restaura todos os colisores da ilha. |
| **`T7.1`** | **Física & Visual Submarino (`PhysicsVehicle` + `VisualVehicle`)** | Carro ganha domo/turbinas e flutua/mergulha suavemente com `WASD` + `Espaço`/`Shift`, deixando rastro de bolhas. |
| **`T7.2`** | **Terreno Submarino + Cáusticas TSL + God Rays** | Fundo do mar `192×192 m` com vales, arcos de pedra e shader de cáusticas animadas rodando a ≥ 60 fps em Q0. |
| **`T7.3`** | **Floresta de Kelp + Corais + Cardumes Instanciados** | Algas abrem passagem para o veículo sem popping; cardumes e bolhas adicionam vida sem ultrapassar o orçamento de 180 draw calls. |
| **`T7.4`** | **Circuito de Argolas Submarino + Cápsulas + Mapa 2D Underwater** | 8 anéis 3D cronometrados com Top 5 local (`vn_uw_circuit_v1`), cápsulas interativas e `Map.js` alternando automaticamente para `map-underwater.webp` quando submerso. |
| **`T7.5`** | **Conquistas, Áudio Lowpass, Review + Passe Adversarial (`G7`)** | 4 novas conquistas (*Mergulhador*, *Piloto Abissal*, *Cardume*, *Explorador dos Dois Mundos*), compressão Draco/WebP e validação completa em WebGPU + WebGL2 + Mobile. |

---

## 5. Riscos & Mitigações

- **Vazamento de colisores Rapier ao alternar reinos:** agrupar todos os `RigidBody` por reino (`surfaceBodies[]` e `underwaterBodies[]`) no `Physics.js`, alternando `body.setEnabled(active)` em lote na transição.
- **Perda de performance com dois mundos na GPU:** manter `underwaterGroup.visible = false` na superfície e `surfaceGroup.visible = false` debaixo d'água; pausar `ticker` dos módulos do reino inativo.
- **Desorientação em 3D livre:** limitar profundidade (`Y: -15m .. -1.2m`) com empuxo automático suave e manter `View.js` com ângulo diorama familiar + indicador luminoso do Farol de Retorno.
