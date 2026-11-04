# Plan de finalización de Consta

## Instrucciones para el agente ejecutor

Este documento describe el trabajo que falta para completar el flujo de investigación de identidad y conexiones en Consta. El repositorio ya tiene trabajo avanzado y puede contener cambios sin confirmar. Antes de editar, lee este plan y revisa el estado actual de los archivos. Continúa desde lo que exista; no reemplaces componentes completos ni reviertas cambios previos sin entenderlos.

La prioridad es reutilizar contratos, búsquedas, investigación de identidad, catálogo de fuentes y puntuación existentes. No agregues base de datos, proveedor, servicio, dependencia ni infraestructura nueva para esta función.

El resultado debe ser una experiencia completa y coherente en backend y frontend. En particular, el frontend requiere un rediseño visual amplio de la experiencia de investigación, no solo una pantalla técnica para consumir el nuevo endpoint.

## Objetivo del producto

Cuando una persona busca a alguien o una institución, Consta debe permitir resolver su identidad en dos pasos y después investigar conexiones verificables:

1. El usuario pulsa **“Es este”** una primera vez y ve una vista previa compacta del candidato.
2. El usuario confirma desde esa vista previa. Entonces ve el perfil completo (los 15 campos existentes) y empieza la investigación de conexiones.
3. En cada vuelta, la IA propone búsquedas, se ejecutan con las herramientas actuales, se identifican hasta cinco entidades importantes del lote, y después se extraen afirmaciones concretas con sus fuentes y su afirmación madre.
4. Las afirmaciones pasan por el sistema de puntuación existente y se visualizan como una red legible de afirmaciones, entidades y fuentes.

La investigación debe ser útil para un periodista: mostrar qué se sabe, qué fuente respalda cada hecho, qué afirmación llevó a la siguiente búsqueda y cuánta confianza merece cada resultado.

## Decisiones ya tomadas

- Cada llamada a `POST /identity/connections` ejecuta **una sola vuelta**. El frontend encadena las llamadas mientras `canContinue` sea verdadero.
- Máximo **tres vueltas** por proceso; detener antes cuando no aparezcan afirmaciones nuevas o el backend marque una razón de parada.
- En cada lote, identificar hasta **cinco instituciones, empresas y personas públicas**, priorizando las más importantes para seguir las conexiones. Resolver las entidades con el mecanismo de identidad y herramientas ya existentes. No volver a investigar una entidad resuelta.
- El orden de cada vuelta es: **planear queries → buscar → identificar entidades → razonar y extraer afirmaciones → validar fuentes → puntuar → decidir si continúa**.
- Las queries conservan el formato actual, incluidos `query`, `purpose` y `tool` (`tavily` o `wikidata`).
- La respuesta de extracción debe contener afirmaciones muy específicas y una afirmación madre. El contrato de salida del modelo es `{"claims":[{"afirmacion":"…","afirmacionMadre":"…","sources":[1,4]}]}`. El prompt entrega resultados numerados; la IA solo devuelve índices de fuente, y el backend valida los índices y adjunta las URLs reales.
- Rechazar referencias a índices, posiciones, “resultado 3”, “fuente 2” y atribuciones genéricas dentro del texto de la afirmación.
- La afirmación madre se resuelve a un `parentId` existente. La afirmación raíz es `El sujeto investigado es <candidato>.`; su id es `root`, y no cuenta para el resumen de hallazgos.
- El resumen del sujeto separa `who` (descripción corta de quién es) de `findings` (lo encontrado). Solo incluir afirmaciones con confianza **probable o corroborada**, nunca inciertas. Mostrar como máximo las tres de mayor puntaje.
- El hallazgo inicial de identidad y sus dos búsquedas extra mantienen su contador actual. Las rondas de conexiones son estado separado y no consumen ese límite.
- Recalibración acordada: primaria 58, secundaria 52, terciaria 15; fuente oficial +18; repetición una 0, dos 14, tres o más 28; ninguna afirmación con una sola fuente puede superar 79. Para marcar corroborada se necesitan al menos dos fuentes independientes. Duplicados sindicados, dos URLs del mismo dominio o copias del mismo comunicado no cuentan como corroboración.
- Clasificar blogs personales, páginas SEO, redes sociales, agregadores, republicaciones o páginas sin autor como terciarias, salvo que el documento sea fuente primaria real.
- Sin cambios de base de datos, proveedor de IA/búsqueda, paquetes ni infraestructura.

## Estado conocido del repositorio

El contexto de trabajo previo informa que estos cambios ya se habían iniciado. Confirma el estado real antes de actuar; la lista no sustituye una inspección del repositorio:

- `packages/contracts/src/types.ts`: contratos de entidades, afirmaciones, rondas y estado de conexiones.
- `backend/src/sourceScore.ts`: recalibración de puntajes y helpers para independencia de fuentes.
- `backend/src/identity.ts`: flujo de identidad actual y lógica del loop de conexiones.
- `backend/src/index.ts`: endpoint `POST /identity/connections`.
- `backend/README.md`: documentación del endpoint y del flujo.
- `frontend/lib/identity.ts`: cliente del endpoint.
- `frontend/components/identity/IdentityProvider.tsx`: estado de preview/confirmación y llamadas encadenadas.
- `frontend/components/identity/IdentityPanel.tsx`: presentación del perfil y conexiones.
- `frontend/components/identity/ClaimsWeb.tsx`: visualización de afirmaciones, entidades y relaciones.
- `frontend/app/globals.css`: estilos de identidad y red de conexiones.

También se indicó que la investigación real guardada para una prueba está en `%TEMP%\consta-identity.json` y que el API local puede estar disponible en `http://127.0.0.1:8788`. Son recursos opcionales y pueden haber caducado; no asumir que existen ni exponer secretos de `.dev.vars`.

## Fase 0: reconocer el proyecto y proteger el trabajo existente

1. Leer `README.md`, `package.json`, `pnpm-workspace.yaml` y cualquier instrucción de agentes del repositorio.
2. Ejecutar `git status --short`; distinguir cambios de producto, cambios previos del usuario y artefactos de QA. No limpiar ni revertir cambios a ciegas.
3. Leer los contratos y componentes actuales de identidad antes de cambiar interfaces.
4. Seguir los patrones ya usados para `searchTavily`, `searchWikidata`, `searchIdentityQuery`, `callOpenRouter`, `scoreResults`, deduplicación de URLs/queries y manejo de errores.
5. Si alguna decisión de este plan contradice un contrato implementado y usado, adaptar el plan solo tras comprobar el impacto y mantener el comportamiento acordado arriba.

**Entrega de la fase:** mapa breve de los componentes y funciones existentes y lista de huecos concretos que faltan. Después continuar con las fases, sin esperar otra confirmación.

## Fase 1: contratos y backend de conexiones

### 1.1 Contratos

Revisar que los tipos compartidos expresen claramente:

- Entidad: id estable, nombre canónico, tipo, descripción breve, fuentes, puntaje y confianza.
- Afirmación: id estable, texto específico, `parentId` nullable, `parentText` de respaldo, fuentes reales adjuntas, entidades relacionadas, puntaje, confianza y número de vuelta.
- Vuelta: número, queries planeadas, búsquedas, entidades resueltas, afirmaciones nuevas, razón de parada y estado detenido.
- Resumen del sujeto: quién es, hallazgos, texto combinado opcional y número de afirmaciones elegibles.
- Estado del loop: afirmaciones, rondas, resumen, `canContinue` y `stoppedReason`.
- Solicitud: nombre, detalles opcionales, investigación actual, id del candidato confirmado y estado previo de conexiones opcional.
- Respuesta: el estado actualizado y un error tipado cuando corresponda.

Evitar duplicar estructuras que ya existan. Los contratos deben serializarse como JSON sin depender de clases del navegador.

### 1.2 Ruta HTTP

Implementar o terminar `POST /identity/connections` usando el estilo de validación y errores que utiliza `backend/src/index.ts`:

- Requerir `name`, `candidateId` y la investigación actual con `plan`, `rounds` y `candidates`.
- Validar tamaños y tipos; si hay estado previo, validar sus colecciones y campos esenciales.
- Responder 400 para cuerpo inválido o candidato ausente; errores de proveedor/búsqueda deben conservar el formato API del proyecto.
- No aceptar URLs de fuente aportadas libremente por el modelo como confiables. Las URLs de respuesta deben salir del catálogo de resultados del backend.
- Una llamada adicional con estado terminado no debe ejecutar nuevas búsquedas.
- Un error transitorio no debe borrar el estado y las rondas ya completadas.

### 1.3 Ejecución de una vuelta

Usar funciones y proveedores actuales. Implementar la vuelta de forma secuencial para que cada etapa reciba el resultado validado de la anterior:

1. Crear la afirmación `root` si aún no existe y preparar `who` desde el perfil inicial.
2. Pedir 3–5 queries relacionadas con afirmaciones previas o entidades ya encontradas. No repetir queries anteriores; usar el mismo contrato y herramientas existentes.
3. Ejecutar las búsquedas a través de la abstracción actual. Acumular sus resultados en el catálogo de la investigación de conexiones y deduplicar por URL/consulta como ya lo hace el proyecto.
4. Numerar de forma determinista solo los resultados de este lote que se entregan al prompt siguiente.
5. Pedir al modelo las cinco entidades más importantes como máximo. Exigir que el nombre aparezca en título o extracto. Excluir el sujeto y entidades ya resueltas. Resolver cada entidad nueva con el flujo de identidad actual, incluyendo una descripción breve y fuentes. Aplicar un límite explícito para que el paso no haga una investigación ilimitada.
6. Dar al modelo los resultados numerados, entidades identificadas, contexto del sujeto y afirmaciones previas; extraer hasta cinco afirmaciones específicas. Exigir un id de madre del conjunto previo o `root`, y una lista de índices válidos.
7. Validar JSON, longitud y campos; descartar índices fraccionarios, negativos o fuera de rango; convertir los índices válidos a referencias de fuente del catálogo del backend. Rechazar afirmaciones sin fuentes.
8. Asociar entidades solo si hay evidencia razonable de que la afirmación las menciona. No inferir una conexión a partir de la mera coexistencia de nombres en resultados distintos.
9. Puntuar con la recalibración acordada, eliminar duplicados exactos y semánticos, enlazar la afirmación madre y actualizar el resumen.
10. Si la vuelta no produce una afirmación nueva/actualizada útil, detener. También detener tras la tercera vuelta. Devolver `canContinue` y `stoppedReason` coherentes con el estado.

El prompt de extracción debe instruir expresamente que se trata de investigación periodística y que el contexto previo es hipótesis de búsqueda, no evidencia. Una afirmación debe describir un hecho concreto comprobable (por ejemplo, cargo, contrato, monto, fecha, sociedad, nombramiento o sanción). Rechazar formulaciones vagas como “está relacionado con X” cuando no digan cómo.

### 1.4 Puntuación

Revisar tanto la puntuación de la investigación inicial como la agregación de las fuentes citadas por una afirmación:

- Primaria 58, secundaria 52, terciaria 15.
- Oficial +18.
- Repetición independiente: una fuente 0; dos fuentes/dominos independientes +14; tres o más +28.
- Puntaje máximo 79 con una única fuente.
- Confianza derivada de los rangos ya acordados por el proyecto: 1–50 incierto, 51–79 probable y 80–100 corroborado.
- Para la corroboración, comprobar independencia real: no contar dos URLs del mismo host, notas sindicadas/republicadas ni el mismo comunicado replicado.
- En afirmaciones, guardar solo las fuentes realmente citadas y validadas. No promover una afirmación por fuentes encontradas en otro asunto del mismo lote.

No cambiar el rango de etiquetas ni las reglas anteriores sin evidencia en código que exija un ajuste. Añadir pruebas deterministas para los límites y casos de independencia.

## Fase 2: completar el frontend funcional

### 2.1 Flujo de selección en dos pasos

- Mantener un id de candidato en preview y otro confirmado; evitar que un único clic dispare búsquedas costosas.
- Primer clic: expandir tarjeta con resumen corto, ocupación/identidad principal y acción explícita de confirmación.
- Segundo clic sobre la acción **“Confirmar identidad y ver perfil”**: fijar candidato, mostrar 15 campos, descripción de quién es y activar el loop.
- Mostrar estados de carga, progreso de cada etapa, errores recuperables, parada por falta de hallazgos y límite de tres vueltas.
- Proteger frente a doble submit, desmontaje o cambio de candidato durante peticiones. No ejecutar dos cadenas de conexiones simultáneas para el mismo candidato.
- Conservar investigaciones y límites existentes de búsquedas extra; conexiones en estado separado.

### 2.2 Integración del loop

- Añadir un cliente tipado para `/identity/connections` con manejo de errores coherente con `frontend/lib/identity.ts`.
- Encadenar como máximo tres llamadas, usando la respuesta de cada vuelta como estado de la siguiente.
- Mostrar el progreso por fases en lenguaje natural: “Buscando conexiones”, “Identificando personas e instituciones”, “Contrastando afirmaciones”. No mostrar detalles internos del prompt.
- Mantener visibles afirmaciones ya obtenidas si una vuelta posterior falla.
- Ofrecer una acción de reintento solo cuando el error sea reintentable; respetar límites de ronda y no duplicar afirmaciones.

## Fase 3: rediseño visual completo del frontend

Esto es un requisito central. No limitar el trabajo a añadir la visualización conectada al endpoint. Dar un lavado de cara a la experiencia de investigación existente (inicio/búsqueda, candidatos, perfil, estados de carga, fuentes y conexiones) con un lenguaje visual coherente.

### Dirección de arte

- Sensación: una sala de investigación tecnológica y elegante, con claridad y cuidado visual al nivel de pulido de Apple; una capa lúdica de mapa/aventura que haga amable seguir pistas, sin parecer una plantilla infantil ni un dashboard genérico.
- La metáfora principal es **seguir un hilo de evidencia**: el usuario comienza con una persona, confirma su identidad y recorre afirmaciones y entidades relacionadas como nodos de un mapa.
- Preferir composición editorial, aire, jerarquía tipográfica fuerte, transiciones suaves, superficies limpias y una paleta limitada. Puede usarse una escena oscura/cinematográfica para la red de conexiones, con acento rojo reservado al hilo y a los enlaces activos. El resto del producto debe conservar legibilidad y no convertirse en una pantalla negra de ciencia ficción.
- No copiar logos, componentes ni pantallas de Apple. Tomar como referencia la sencillez, precisión, tipografía, espacio y atención al detalle.
- Diseñar un sistema que se sienta amigable y tecnológico: microcopy claro, puntos de progreso, pistas visuales sutiles y estados que expliquen qué ocurre.

### Renovación de las pantallas existentes

1. **Búsqueda:** convertir el campo de nombre en el punto focal; dar contexto corto sobre qué buscar y cómo se usa la información. Añadir tratamiento de foco, submit y carga cuidados.
2. **Candidatos:** tarjetas jerarquizadas y escaneables con nombre, descripción corta, señal de identidad y CTA “Es este”. Primer clic abre el preview claramente diferenciado.
3. **Preview y confirmación:** resumen breve de quién es, fuentes visibles y botón final claro. Hacer perceptible que el clic inicial no inicia la investigación de conexiones.
4. **Perfil:** mostrar los 15 campos en una composición compacta, con estados encontrado/no encontrado y enlaces de fuente accesibles; priorizar lectura en vez de una cuadrícula densa.
5. **Progreso:** una secuencia visual sobria de fases/vueltas que explique la actividad. El progreso nunca debe fingir que hay resultados confirmados antes de tenerlos.
6. **Afirmaciones:** tarjetas editoriales legibles con texto, puntaje/confianza, cantidad y enlaces de fuentes y relación madre/hija.
7. **Errores y vacío:** diseñar estados útiles para cero resultados, falta de conexiones nuevas y errores recuperables.

### Visualización cinematográfica de conexiones

- Presentar cada afirmación como nodo/tarjeta principal. Alrededor, o en un recorrido adaptable, poner tarjetas para las identidades relacionadas con nombre, tipo, resumen corto y enlaces.
- Conectar madre → hija y entidad → afirmación con un hilo rojo fino, curvo y animado con moderación. El hilo expresa una relación respaldada, no una relación causal inventada.
- Si hay muchas tarjetas o el espacio es estrecho, cambiar a una línea vertical cronológica/relacional; nunca recortar texto ni ocultar fuentes.
- Permitir navegar desde una hija a su afirmación madre y volver; hacer obvio el orden de procedencia.
- La escena de red puede tener fondo profundo, viñeta o textura casi imperceptible y contraste alto. Evitar grano que afecte legibilidad, resplandor excesivo o animaciones constantes.
- Incluir en cada afirmación un acceso directo a sus fuentes y la razón visual del badge de confianza. No representar `incierto` como un hecho sólido.
- En desktop, aprovechar espacio para una composición de mapa con el foco en la afirmación seleccionada. En móvil, convertirla en una secuencia vertical con conectores simples.

### Requisitos de diseño e interacción

- Reusar el framework, CSS y componentes ya instalados. No incorporar bibliotecas o fuentes remotas nuevas.
- Adaptar a móvil, tablet y escritorio; evitar scroll horizontal y controles pequeños.
- Cumplir contraste, foco de teclado, etiquetas accesibles y navegación por teclado.
- Respetar `prefers-reduced-motion`; toda animación del hilo y las transiciones debe tener una alternativa estática.
- Mantener animaciones cortas y útiles (revelar tarjeta, dibujar una conexión al aparecer). Ninguna información dependerá únicamente del color o movimiento.
- Mantener el estilo consistente entre búsqueda, investigación, fuentes, perfil y red.

**Criterio visual:** alguien que no conoce el proyecto debe entender dónde iniciar, qué candidato está viendo, qué significa confirmar y cómo una afirmación se conecta a su evidencia. Debe sentirse intencional, elegante y acogedor; no como un formulario administrativo ni como un conjunto de tarjetas sin jerarquía.

## Fase 4: revisión y verificación por quien ejecute

Esta fase pertenece al agente que implemente el trabajo. El plan por sí solo no cambia código ni declara que esas verificaciones se hayan realizado.

1. Ejecutar pruebas de contrato y backend: entrada inválida, candidato ausente, mapeo correcto de índices de fuente, índice fuera de rango, ids de madre, deduplicación, límites 5 entidades/3 vueltas, parada temprana y error recuperable.
2. Cubrir score: cada nivel de fuente, oficialidad, un dominio con varias URLs, dos dominios distintos, fuente sindicada/republicada y máximo 79 con una fuente.
3. Cubrir frontend: primer clic solo preview, segundo clic confirma, perfil de 15 campos, autoencadenado hasta 3, parada temprana, error posterior preserva resultados y cambio de candidato no mezcla estado.
4. Ejecutar typecheck y build de los paquetes afectados, luego los comandos globales documentados por el repo.
5. Hacer revisión visual en viewport desktop y móvil, incluyendo una afirmación con varias entidades, una afirmación hija, una fuente larga y `prefers-reduced-motion`.
6. Si existe un API local/configuración real, usar una investigación guardada como smoke test sin imprimir ni copiar secretos. No convertir una dependencia de servicios externos en requisito para los tests deterministas.
7. Revisar `git diff` completo y explicar los cambios, verificaciones ejecutadas y límites restantes. No borrar capturas ni archivos temporales ajenos sin verificar su origen.

## Criterios de aceptación

- La selección del candidato requiere dos acciones distintas y visibles; la primera no dispara conexiones.
- El perfil confirmado muestra los 15 campos existentes y un contexto `who` entendible.
- El loop ejecuta el orden acordado, no supera cinco entidades nuevas por vuelta ni tres vueltas, y para con claridad.
- Cada afirmación tiene texto específico, madre enlazada, fuentes reales del catálogo y score/confianza calculados por el backend.
- Los índices devueltos por la IA nunca se muestran ni se convierten en URLs sin validar.
- El resumen usa afirmaciones probables y corroboradas, excluye inciertas, excluye `root` y no excede tres hallazgos.
- La puntuación impide que una sola fuente sea corroborada y no confunde publicaciones del mismo origen con corroboración independiente.
- La experiencia visual se renueva en las pantallas principales, no solo en la nueva sección de conexiones.
- La red visual hace comprensible la relación madre/hija y la evidencia; en móvil sigue siendo navegable y legible.
- No se incorpora infraestructura ni dependencia nueva.
- Las verificaciones reportadas reflejan comandos realmente ejecutados y resultados observados.

## Orden de implementación recomendado

1. Reconocer el estado real y contratos actuales.
2. Corregir/completar contratos y lógica de puntuación.
3. Completar y estabilizar endpoint y etapas del loop.
4. Integrar cliente, selección de dos pasos y encadenado en frontend.
5. Rediseñar búsqueda, candidatos, perfil, estados y conexiones como una experiencia visual unificada.
6. Verificar backend, frontend, móvil/accesibilidad y el diff completo.

Si hay que trabajar por partes, no reemplazar un tipo o componente compartido mientras otra parte aún depende del contrato anterior. Mantener el proyecto compilable al finalizar cada fase.
