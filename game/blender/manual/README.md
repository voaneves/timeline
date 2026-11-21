# Manual Overrides (`game/blender/manual/`)

Esta pasta guarda arquivos `.blend` editados à mão que substituem (por nome exato do objeto) as malhas geradas proceduralmente pelos scripts em `game/blender/`.

Qualquer ajuste manual salvo aqui **sobrevive a uma regeração completa** do pipeline (`build_all.py`).

## Fluxo de edição

1. **Abra o `.blend` gerado** (em `game/blender/out/<asset>.blend`) no Blender, ou gere um arquivo inicial limpo com `vn_manual.export_for_manual_edit("<asset>", objects)`.
2. **Edite a malha desejada mantendo exatamente o mesmo nome de objeto** no Outliner (ex.: `HeroBox`, `F1_Chassis`, `C130_Fuselage`).
   - Você pode esculpir, extrudar, subdividir, ajustar UVs, materiais ou escala.
   - Não renomeie o objeto se quiser que ele substitua o objeto procedural correspondente.
3. **Salve o arquivo em `game/blender/manual/<asset>.blend`** (ou `game/blender/manual/<NomeDoObjeto>.blend` para override individual).
4. **Rode novamente `build_all.py`** (ou o script gerador do asset).
   - O gerador chama `vn_manual.apply_manual_overrides("<asset>")` antes de exportar o `.glb`.
   - A geometria manual substitui a geometria procedural, preservando por padrão **coleção**, **hierarquia (parent)** e **custom properties** (como `mass`, `friction`, `category`).
   - Todo objeto substituído recebe a marcação `vn_manual_override = "<asset>.blend"` e aparece no log `[vn_manual]`.

## Versionamento (Git)

- **Arquivos `.blend` em `game/blender/manual/` são arquivos-fonte humanos e DEVEM ser commitados no Git.**
- Arquivos gerados em `game/blender/out/` são saídas descartáveis e regeneráveis pelo pipeline.
