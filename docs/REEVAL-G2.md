# Reavaliação pós-G2 (2026-11-21)

Origem: feedback do dono depois de jogar o preview G2 e das referências enviadas.

## 1. O que está errado no processo (não só no jogo)

O risco R12 do plano ("avaliação inflada") aconteceu de novo. Todos os gates automáticos passaram (fps, draw calls, bytes, axe, ghosts), mas o dono achou:

- faixa piscando no começo (z-fighting: faixa de laterita coplanar com o chão);
- caixa tosca e manchas escuras nas quinas (AO em faces grandes, pilar provisório);
- cano que lança o jogador rápido demais e o deixa preso dentro do cano (destino dentro do colisor);
- "folhas" piscando (borboletas e capim com frequência alta demais);
- casa sem colisão (colisor não virou corpo sólido após ir para `origensObjects`);
- borda do mapa: cai no vazio e vê o fundo cru da página; capim nascendo fora da ilha;
- terreno plano, sem interesse.

Causa comum: os testes medem **números**, não **o que se vê e o que se toca na câmera de jogo**. Preview de Blender e contact sheet de 4 fps não pegam flicker, z-fighting nem atravessar parede.

Regra nova (substitui o critério de aceite por número isolado): **nenhuma tarefa de mundo fecha sem (a) screenshot na câmera de jogo, (b) teste automático de colisão e (c) teste automático de flicker.**

## 2. O que as referências fazem e nós não fazemos

| Referência | O que ensina | Aplicação |
|---|---|---|
| mesqme/infinite-terrain | Terreno em chunks, altura por ruído (fBm), criação e reciclagem de chunks ao redor do jogador, shader de terreno com dither, capim e pedras instanciados por mapa de densidade | Trocar o retângulo plano por terreno em chunks com relevo. Não precisa ser infinito: raio grande + névoa + horizonte resolvem a borda |
| Claybound | Estilo "massinha": caixas arredondadas com vértices deslocados por ruído de baixa frequência + normal map de digitais. Three.js puro, meshopt, passo fixo com interpolação, sombra otimizada. Coesão vem do **material**, não da paleta de marca | Um único shader/material "clay" em tudo (terreno, casas, caixotes, Victor). Elimina a caixa tosca e dá a coesão que falta |
| Messenger (Abeto) | Planeta pequeno e esférico: sem paredes invisíveis e sem borda. Three.js + three-mesh-bvh para colisão, sem engine. Pintura/textura estilizada, interação mínima | Opção de mundo curvo ou, no mínimo, ilha cercada por mar/névoa sem fundo visível |
| Horizon Drive (Shopify) | Sem física pesada: lógica por spline (normais e tangentes). Instancing para partículas, compressão por textura, WebAudio, poucos MB, 60 fps mobile | Nossa Linha já é spline: usar para câmera e guia. Mais juice com instancing |
| One Year (Cosmic Shelter), TinySkies, ZPM, Endurance | Portfólio como mundo jogável; feedback e juice em cada ação; mundo contínuo | Mundo contínuo, descoberta, resposta imediata a cada toque |

(Pesquisa feita por busca; não abri os sites. Antes de copiar qualquer técnica, o dono deve confirmar nos próprios sites o que quer espelhar.)

## 3. Decisões propostas

1. **Parar a expansão (Fase 3/4) até o G2 passar de verdade.** Scripts Blender de eras novas sobre uma fundação com glitch só multiplicam o problema. As eras 2–5 já geradas ficam no repo, mas fora do preview.
2. **Fase 2.5: fundação visual e física** (abaixo).
3. **Lançar primeiro só Origens + Hub** (decisão D14 do plano), com os outros marcos acessíveis por cards.
4. **Estilo único "massinha" (clay)** substitui "papel e tinta" como direção de material. O dono já liberou sair da marca.

## 4. Fase 2.5: tarefas pequenas

| ID | Entregável | Aceite |
|---|---|---|
| F1 | Z-fighting: faixa de laterita e qualquer plano coplanar; usar relevo real ou polygon offset | Captura na câmera de jogo sem cintilação (diferença entre frames consecutivos parado ≤ limiar) |
| F2 | Colisão: auditoria automática que anda um ghost contra cada colisor e confere que bloqueia; corrigir casa e telhado | 100% dos colisores `cuboid*` bloqueiam; a casa não é atravessada |
| F3 | Cano: destino acima e à frente da boca, impulso para fora, nunca dentro do colisor | Ghost entra, sai, e pode andar; 0 frames dentro de colisor |
| F4 | Capim e borboletas: frequência de vento e asa baixa; capim só em terra firme (máscara) | Sem flicker (teste de variação por quadro) e 0 lâminas fora da ilha |
| F5 | Borda: mar/horizonte contínuo com a cor da névoa; nunca mostrar o fundo da página; contenção suave | Câmera nunca vê `#10266f`; jogador não cai no vazio |
| F6 | Terreno em chunks com ruído, relevo suave, caminhos escavados, instancing de pedras e tufos | Captura na câmera de jogo mostra relevo; draw calls Q1 ≤ 120 |
| F7 | Material clay único (deslocamento de baixa frequência + normal map de digitais) em tudo | Revisão visual do dono; nenhuma peça com cara de caixa primitiva |
| F8 | Novo gate "olho do dono": 6 capturas na câmera de jogo por era (spawn, marco, cano, borda, grind, retrato), revisadas por um agente e depois pelo dono | Revisão com lista de problemas = 0 Alto |

## 5. O que preciso do dono

1. Confirmar a direção "massinha" (Claybound) como estilo único, ou escolher outra.
2. Confirmar mundo cercado por mar/névoa (rápido) ou mundo curvo estilo Messenger (mais trabalho).
3. Confirmar que eras 2–5 ficam fora do preview até a fundação passar.

## 6. Estado dos agentes

Os executores atingiram a cota (volta em ~1h50). O último lote de correções da Fase 3 ficou incompleto (nenhum arquivo dele foi commitado). A retomada está agendada.

---

## 7. Tidewater (dgreenheck/tidewater): reaproveitamento autorizado

Licença: **MIT, Copyright (c) 2026 DRG Software Solutions LLC**. O dono autorizou reaproveitar tudo. Uso exige manter o aviso de copyright e o texto MIT em `game/LICENSES.md` e o cabeçalho de atribuição em cada arquivo derivado, como já fazemos com o outro motor base. Áudio (42 gravações Freesound, CC0) e props (Poly Haven, CC0) têm créditos próprios em `CREDITS.md` do repositório.

Clone de leitura: `D:\GitHub\_vendor\tidewater` (fora do repo servido).

### O que é e por que não dá para "colar"

- Motor próprio em **WebGPU cru + WGSL**, sem three.js e sem dependências de runtime. Nosso jogo roda em three/webgpu (TSL) e o celular usa WebGL2 por padrão.
- Alvo declarado: 60 fps a 2560x1267 num Apple M5 Pro; primeira carga compila centenas de shaders ("um minuto ou mais"). Isso viola o orçamento do plano (carga ≤ 6,5 s no celular, ≤ 3 MB até o controle).
- Estilo realista (PBR, atmosfera física, cenas de foto). Nossa direção é brinquedo estilizado.

Conclusão: **portar técnicas e módulos escolhidos**, não adotar o motor. O three expõe `wgslFn` no TSL, que permite embutir WGSL (os compute shaders do FFT) sem reescrever tudo em nós TSL. Só vale no backend WebGPU.

### Mapa de reaproveitamento

| Módulo (src/…) | Tamanho | Uso no nosso jogo | Tier |
|---|---|---|---|
| `ocean/OceanFFT.js` (+ spectra) | 23 KB | Oceano ao redor da ilha, 2 cascatas | Q0 (WebGPU) |
| `ocean/FoamTexture.js`, Jacobiano | 4 KB | Espuma | Q0 |
| `ocean/Breakers.js`, swash | 38 KB | Espuma e onda na costa (F5c) | Q0, versão reduzida |
| `ocean/Caustics.js` | 14 KB | Cáusticas no fundo | Q0, opcional |
| `world/terrain/TerrainNoise.js`, `IslandShape.js`, `TerrainBake.js` | 18 KB | Terreno com relevo (F6) | Q0 e Q1 (bake) |
| `world/terrain/TerrainShading.js`, `DetailTextures.js` | 21 KB | Base do shader de terreno, restilizado | Q0 e Q1 |
| `world/vegetation/GrassField.js`, `Scatter.js`, `InstanceLOD.js`, `Impostors.js` | 88 KB | Capim e vegetação por instância, LOD | Q0 e Q1 (densidade menor) |
| `world/wildlife/*` (aves, caranguejos, sombras blob) | ~150 KB | Vida ambiente no lugar das borboletas | Q0, parcial no Q1 |
| `sky/*` (atmosfera, nuvens) | — | Céu e névoa de horizonte | Q0; Q1 usa gradiente |
| `public/audio/*` (CC0) | 42 arquivos | Ondas, vento, aves, passos. Escolher poucas, ≤ 350 KB por era | pós-reveal |
| `materials/LODFade.js` (dither), `GroundBounce.js` | 11 KB | Transição de LOD sem pop, luz de bounce | Q0 e Q1 |

Ficam de fora: pesca, vendedores, barco, baleia, recife, vila (conteúdo do jogo deles, não nosso).

### Tarefas novas (entram na Fase 2.5)

| ID | Entregável | Aceite |
|---|---|---|
| T1 | Registrar atribuição MIT (LICENSES.md + cabeçalhos) e créditos CC0 dos áudios escolhidos | `audit-originality` ok; texto da licença completo |
| T2 | Terreno: portar ruído, forma de ilha e bake; mundo em chunks ou ilha grande com relevo | Captura na câmera de jogo mostra relevo; Q1 ≤ 120 draw calls |
| T3 | Capim e vegetação por instância com LOD e dither, só em terra firme | Sem cintilação; 0 lâminas fora da ilha; Q1 ≤ 40% do Q0 |
| T4 | Oceano Q0: FFT de 2 cascatas via `wgslFn`, espuma por Jacobiano | ≥ 60 fps desktop; sem borda visível |
| T5 | Oceano Q1/Q2: ondas analíticas + espuma de costa (sem compute, WebGL2) | ≥ 55 fps no celular; mesmo visual de cor e horizonte |
| T6 | Costa: faixa de espuma e swash na linha d'água | Captura com a faixa visível |
| T7 | Áudio de campo CC0: ondas, vento, aves | Mix ≤ -1 dBTP; áudio da era ≤ 350 KB |

### Decisão de estilo que o dono precisa tomar (importante)

As referências puxam em duas direções:

- **Estilizado** (Claybound, Messenger, Wonder): massinha e pintura, coesão pelo material.
- **Realista** (Tidewater, infinite-terrain): PBR, atmosfera física.

Recomendação: **mundo estilizado, tecnologia do Tidewater.** Usar o FFT, o terreno, o capim e o LOD dele, mas com um passe de cor e material estilizado (cores chapadas na paleta, sombra suave, contorno só no Victor). Assim o oceano e o terreno ganham a riqueza que falta, sem o jogo virar uma cena realista com um boneco de brinquedo dentro.

### Ordem de execução proposta

1. Estilo e borda decididos pelo dono (ou padrão: estilizado + oceano).
2. T1 (licença) primeiro: barato e obrigatório antes de qualquer cópia.
3. F1–F4 (bugs que o dono viu) em paralelo com T2/T3.
4. T4–T7.
5. F8: revisão por captura na câmera de jogo e playtest do dono.
