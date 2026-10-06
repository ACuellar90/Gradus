// ─────────────────────────────────────────────
//  LÓGICA DE CÁLCULO (inline, sin importar logica.js)
// ─────────────────────────────────────────────
function calcularPeriodo(promCotidiana, promIntegradora, notaExamen, bonoFinal = 0) {
    const pC = parseFloat(promCotidiana) || 0;
    const pI = parseFloat(promIntegradora) || 0;
    const nE = parseFloat(notaExamen) || 0;
    const bF = parseFloat(bonoFinal) || 0;
    const final = Math.min(10, (pC * 0.35) + (pI * 0.35) + (nE * 0.30) + bF);
    return { notaFinal: final.toFixed(1) };
}

// ─────────────────────────────────────────────
//  ALMACENAMIENTO LOCAL (antes: Supabase)
// ─────────────────────────────────────────────
import * as db from './db.js';

// ─────────────────────────────────────────────
//  ESTADO
// ─────────────────────────────────────────────
let ajustes = null; // { docente, institucion, anio }
let gradosCache = [];
let gIdx = -1;
let pAct = 1;

// ─────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────
// Evita que un texto escrito por el usuario se interprete como HTML
const esc = (texto) => String(texto ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const ordenarAlumnos = (lista) => {
    const tieneOrden = lista.some(a => a.orden_manual !== undefined && a.orden_manual !== null);
    if (tieneOrden) {
        return lista.sort((a, b) => (a.orden_manual ?? 999) - (b.orden_manual ?? 999));
    }
    return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
};

function obtenerCalculos(al, tareasDelPeriodo) {
    const notas = al.notas || {};
    const bono  = (al.puntos_extra || {})[pAct] || { c: 0, i: 0, e: 0, f: 0 };
    const recup = (al.recuperacion || {})[pAct] || null;

    // Si hay recuperación, usarla en lugar de las notas normales
    if (recup) {
        const pC = Math.min(7, parseFloat(recup.c) || 0);
        const pI = Math.min(7, parseFloat(recup.i) || 0);
        const nE = Math.min(7, parseFloat(recup.e) || 0);
        return { pC, pI, nE, baseExamen: nE, bonoFinal: 0, r: calcularPeriodo(pC, pI, nE, 0), esRecuperacion: true };
    }

    const cots = tareasDelPeriodo.filter(t => t.tipo === 'c').map(t => parseFloat(notas[t.id]) || 0);
    const ints = tareasDelPeriodo.filter(t => t.tipo === 'i').map(t => parseFloat(notas[t.id]) || 0);
    const exas = tareasDelPeriodo.filter(t => t.tipo === 'e').map(t => parseFloat(notas[t.id]) || 0);

    const promBase = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    let pC = Math.min(10, promBase(cots) + (parseFloat(bono.c) || 0));
    let pI = Math.min(10, promBase(ints) + (parseFloat(bono.i) || 0));
    let baseExamen = exas.length ? exas[0] : 0;
    let nE = Math.min(10, baseExamen + (parseFloat(bono.e) || 0));
    let bonoFinal = parseFloat(bono.f) || 0;

    return { pC, pI, nE, baseExamen, bonoFinal, r: calcularPeriodo(pC, pI, nE, bonoFinal), esRecuperacion: false };
}

// ─────────────────────────────────────────────
//  VISTAS
// ─────────────────────────────────────────────
function mostrarVista(id) {
    ['vista-ajustes', 'vista-grados', 'vista-selector-periodo', 'vista-detalle-grado', 'vista-reporte', 'vista-anecdotico'].forEach(v => {
        const el = document.getElementById(v);
        if (el) el.classList.toggle('hidden', v !== id);
    });
}

window.mostrarGrados = async () => {
    const data = await db.todos('grados');
    gradosCache = data.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    mostrarVista('vista-grados');
    document.getElementById('usuario-nombre').textContent = ajustes?.docente || '';
    document.getElementById('subtitulo-institucion').textContent = 'Sistema Docente · ' + (ajustes?.institucion || '');
    renderGrados();
};

window.crearGrado = async () => {
    const nombre = prompt('Nombre del grado (ej: 1° Bachillerato A):');
    if (!nombre || !nombre.trim()) return;
    const materia = prompt('Materia (opcional, ej: Informatica):') || '';
    const data = await db.insertar('grados', { nombre: nombre.trim().toUpperCase(), materia: materia.trim() });
    gradosCache.push(data[0]);
    renderGrados();
};

window.editarGrado = async (id) => {
    const grado = gradosCache.find(g => g.id === id);
    if (!grado) return;
    const nuevoNombre = prompt('Nombre del grado:', grado.nombre);
    if (nuevoNombre === null) return;
    if (!nuevoNombre.trim()) return alert('El nombre no puede estar vacío');
    const nuevaMateria = prompt('Materia (opcional, ej: Informática):', grado.materia || '');
    if (nuevaMateria === null) return;
    await db.actualizar('grados', id, {
        nombre: nuevoNombre.trim().toUpperCase(),
        materia: nuevaMateria.trim()
    });
    grado.nombre  = nuevoNombre.trim().toUpperCase();
    grado.materia = nuevaMateria.trim();
    renderGrados();
};

window.eliminarGrado = async (id, nombre) => {
    if (!confirm(`¿Eliminar "${nombre}" con TODOS sus alumnos y tareas? Esta acción no se puede deshacer.`)) return;
    await db.borrarPorGrado('alumnos', id);
    await db.borrarPorGrado('tareas', id);
    await db.borrarPorGrado('anecdotico', id);
    await db.borrar('grados', id);
    gradosCache = gradosCache.filter(g => g.id !== id);
    renderGrados();
};

// ─────────────────────────────────────────────
//  MEJORA 1: SELECTOR DE PERÍODO (antes de entrar al grado)
// ─────────────────────────────────────────────
window.abrirSelectorPeriodo = (id) => {
    const grado = gradosCache.find(g => g.id === id);
    if (!grado) return;

    document.getElementById('sp-titulo-grado').textContent = grado.nombre;
    document.getElementById('sp-materia-grado').textContent = grado.materia || '';

    // Resaltar período activo si ya había uno seleccionado
    document.querySelectorAll('.btn-periodo-selector').forEach((btn, i) => {
        const p = i + 1;
        btn.className = `btn-periodo-selector w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wider transition-all shadow-sm border-2 ${
            p === pAct
                ? 'bg-blue-600 text-white border-blue-600 shadow-lg scale-105'
                : 'bg-white text-blue-900 border-blue-200 hover:border-blue-400 hover:shadow-md'
        }`;
        btn.onclick = () => abrirGradoConPeriodo(id, p);
    });

    mostrarVista('vista-selector-periodo');
};

window.abrirGradoConPeriodo = async (id, periodo) => {
    pAct = periodo;
    gIdx = gradosCache.findIndex(g => g.id === id);
    if (gIdx === -1) return;

    const [alumnos, tareas] = await Promise.all([
        db.porGrado('alumnos', id),
        db.porGrado('tareas', id)
    ]);

    gradosCache[gIdx].alumnos = alumnos;
    gradosCache[gIdx].tareas  = tareas;

    document.getElementById('titulo-grado-actual').innerText = gradosCache[gIdx].nombre;
    mostrarVista('vista-detalle-grado');
    setPeriodo(periodo);
};

window.abrirGrado = window.abrirSelectorPeriodo; // alias para compatibilidad

// ─────────────────────────────────────────────
//  ALUMNOS
// ─────────────────────────────────────────────
window.agregarAlumno = async () => {
    const input = document.getElementById('input-alumno');
    const nombre = input.value.trim().toUpperCase();
    if (!nombre) return alert('Escribe el nombre del alumno');
    const grado = gradosCache[gIdx];
    const yaExiste = grado.alumnos.some(a => a.nombre === nombre);
    if (yaExiste) return alert('Ese alumno ya está en la lista');
    const data = await db.insertar('alumnos', { grado_id: grado.id, nombre, notas: {}, puntos_extra: {}, recuperacion: {} });
    grado.alumnos.push(data[0]);
    input.value = '';
    renderDetalle();
};

window.importarExcel = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const wb   = XLSX.read(e.target.result, { type: 'binary' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
            const grado = gradosCache[gIdx];
            const nuevos = [];
            for (const row of rows) {
                const nombre = (row[0] || '').toString().trim().toUpperCase();
                if (!nombre || nombre.length < 3) continue;
                const yaExiste = grado.alumnos.some(a => a.nombre === nombre);
                if (yaExiste) continue;
                nuevos.push({ grado_id: grado.id, nombre, notas: {}, puntos_extra: {}, recuperacion: {} });
            }
            if (nuevos.length === 0) { alert('No se encontraron alumnos nuevos en el archivo.'); return; }
            const data = await db.insertar('alumnos', nuevos);
            grado.alumnos.push(...data);
            renderDetalle();
            alert(`✅ ${data.length} alumno(s) importado(s) correctamente.`);
        } catch (err) {
            alert('Error leyendo el archivo Excel: ' + err.message);
        }
    };
    reader.readAsBinaryString(file);
    event.target.value = '';
};

window.eliminarAlumno = async (alId) => {
    if (!confirm('¿Eliminar este alumno?')) return;
    await db.borrar('alumnos', alId);
    gradosCache[gIdx].alumnos = gradosCache[gIdx].alumnos.filter(a => a.id !== alId);
    renderDetalle();
};

// ─────────────────────────────────────────────
//  TAREAS
// ─────────────────────────────────────────────
window.crearTarea = async () => {
    const nom   = document.getElementById('input-tarea-nom').value.trim();
    const tipo  = document.getElementById('input-tarea-tipo').value;
    const fecha = document.getElementById('input-tarea-fecha').value;
    if (!nom)   return alert('Escribe el nombre de la tarea');
    if (!fecha) return alert('Selecciona una fecha');
    const data = await db.insertar('tareas', { grado_id: gradosCache[gIdx].id, nombre: nom.toUpperCase(), tipo, fecha, periodo: pAct });
    gradosCache[gIdx].tareas.push(data[0]);
    document.getElementById('input-tarea-nom').value = '';
    renderDetalle();
};

window.eliminarTarea = async (tId) => {
    if (!confirm('¿Eliminar esta tarea y todas sus notas?')) return;
    await db.borrar('tareas', tId);
    gradosCache[gIdx].tareas = gradosCache[gIdx].tareas.filter(t => t.id !== tId);
    renderDetalle();
};

// ─────────────────────────────────────────────
//  NOTAS Y PUNTOS EXTRA
// ─────────────────────────────────────────────
window.guardarNota = async (alId, tId, val) => {
    const al = gradosCache[gIdx].alumnos.find(a => a.id === alId);
    if (!al) return;
    if (!al.notas) al.notas = {};
    const nota = Math.min(10, Math.max(0, parseFloat(val) || 0));
    al.notas[tId] = nota;
    await db.actualizar('alumnos', alId, { notas: al.notas });
    renderDetalle();
};

window.guardarPuntoExtra = async (alId, tipo, val) => {
    const al = gradosCache[gIdx].alumnos.find(a => a.id === alId);
    if (!al) return;
    if (!al.puntos_extra) al.puntos_extra = {};
    if (!al.puntos_extra[pAct]) al.puntos_extra[pAct] = { c: 0, i: 0, e: 0 };
    al.puntos_extra[pAct][tipo] = parseFloat(val) || 0;
    await db.actualizar('alumnos', alId, { puntos_extra: al.puntos_extra });
    renderDetalle();
};

// ─────────────────────────────────────────────
//  MEJORA 2: RECUPERACIÓN POR ALUMNO
// ─────────────────────────────────────────────
window.abrirModalRecuperacion = (alId) => {
    const al = gradosCache[gIdx].alumnos.find(a => a.id === alId);
    if (!al) return;

    const recup = (al.recuperacion || {})[pAct] || { c: '', i: '', e: '' };
    const partes = al.nombre.split(',');
    const nombreCorto = ((partes[1] || partes[0] || '').trim());

    document.getElementById('modal-recup').classList.remove('hidden');
    document.getElementById('modal-recup-titulo').textContent = nombreCorto + ' — Recuperación P' + pAct;
    document.getElementById('modal-recup-alid').value = alId;
    document.getElementById('recup-c').value = recup.c !== undefined ? recup.c : '';
    document.getElementById('recup-i').value = recup.i !== undefined ? recup.i : '';
    document.getElementById('recup-e').value = recup.e !== undefined ? recup.e : '';
};

window.cerrarModalRecuperacion = () => {
    document.getElementById('modal-recup').classList.add('hidden');
};

window.guardarRecuperacion = async () => {
    const alId = document.getElementById('modal-recup-alid').value;
    const al   = gradosCache[gIdx].alumnos.find(a => a.id === alId);
    if (!al) return;

    const cVal = document.getElementById('recup-c').value;
    const iVal = document.getElementById('recup-i').value;
    const eVal = document.getElementById('recup-e').value;

    // Validar máximo 7
    const c = cVal === '' ? '' : Math.min(7, Math.max(0, parseFloat(cVal) || 0));
    const i = iVal === '' ? '' : Math.min(7, Math.max(0, parseFloat(iVal) || 0));
    const e = eVal === '' ? '' : Math.min(7, Math.max(0, parseFloat(eVal) || 0));

    if (!al.recuperacion) al.recuperacion = {};

    // Si los tres están vacíos, eliminar recuperación del período
    if (c === '' && i === '' && e === '') {
        delete al.recuperacion[pAct];
    } else {
        al.recuperacion[pAct] = { c, i, e };
    }

    await db.actualizar('alumnos', alId, { recuperacion: al.recuperacion });

    cerrarModalRecuperacion();
    renderDetalle();
};

window.quitarRecuperacion = async (alId) => {
    if (!confirm('¿Quitar la recuperación de este período? Se usarán las notas originales.')) return;
    const al = gradosCache[gIdx].alumnos.find(a => a.id === alId);
    if (!al || !al.recuperacion) return;
    delete al.recuperacion[pAct];
    await db.actualizar('alumnos', alId, { recuperacion: al.recuperacion });
    renderDetalle();
};

// ─────────────────────────────────────────────
//  PERÍODO
// ─────────────────────────────────────────────
window.setPeriodo = (n) => {
    pAct = n;
    document.querySelectorAll('#selector-periodos button').forEach((b, i) => {
        b.className = (i + 1 === n)
            ? 'px-4 py-1 rounded-md font-bold text-xs bg-white text-blue-900 shadow-sm'
            : 'px-4 py-1 rounded-md font-bold text-xs text-blue-300';
    });
    renderDetalle();
};

// Recordar qué paneles de detalle están abiertos para que no se cierren al guardar una nota
const detallesAbiertos = new Set();

window.toggleDetalle = (alId) => {
    const el = document.getElementById(`detalle-${alId}`);
    if (!el) return;
    el.classList.toggle('hidden');
    if (el.classList.contains('hidden')) detallesAbiertos.delete(alId);
    else detallesAbiertos.add(alId);
};

// ─────────────────────────────────────────────
//  RENDER GRADOS
// ─────────────────────────────────────────────
function renderGrados() {
    const contenedor = document.getElementById('lista-grados-cards');
    if (gradosCache.length === 0) {
        contenedor.innerHTML = `<p class="col-span-3 text-center text-slate-400 italic mt-8">No hay grados todavía. Crea uno con el botón de arriba.</p>`;
        return;
    }
    contenedor.innerHTML = gradosCache.map(g => `
        <div class="bg-white rounded-3xl shadow-sm border-b-4 border-blue-600 hover:shadow-xl transition-all group overflow-hidden">
            <div onclick="abrirSelectorPeriodo('${g.id}')" class="p-6 cursor-pointer">
                <h3 class="text-xl font-black text-slate-700 uppercase italic group-hover:text-blue-700 transition-colors">${g.nombre}</h3>
                <p class="text-slate-400 text-[10px] mt-1 font-medium">${g.materia || ''}</p>
                <p class="text-emerald-600 text-[10px] mt-2 font-bold uppercase italic">
                    <i class="fas fa-mobile-alt mr-1"></i>Guardado en este dispositivo
                </p>
            </div>
            <div class="border-t border-slate-100 px-4 py-3 flex justify-between items-center">
                <button onclick="event.stopPropagation(); abrirAnecdotico('${g.id}')"
                    class="text-[9px] font-black uppercase text-violet-500 hover:text-violet-700 transition-colors">
                    <i class="fas fa-book-open mr-1"></i>Anecdótico
                </button>
                <div class="flex gap-2">
                    <button onclick="event.stopPropagation(); editarGrado('${g.id}')"
                        class="text-[9px] font-bold text-slate-400 hover:text-blue-600 border border-slate-200 hover:border-blue-400 px-3 py-1 rounded-full transition-all uppercase">
                        <i class="fas fa-pen mr-1"></i>Editar
                    </button>
                    <button onclick="event.stopPropagation(); eliminarGrado('${g.id}', \`${g.nombre}\`)"
                        class="text-[9px] font-bold text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-400 px-3 py-1 rounded-full transition-all uppercase">
                        <i class="fas fa-trash mr-1"></i>Eliminar
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// ─────────────────────────────────────────────
//  RENDER DETALLE
// ─────────────────────────────────────────────
function renderDetalle() {
    const grado = gradosCache[gIdx];
    if (!grado) return;

    ordenarAlumnos(grado.alumnos);
    const tP   = grado.tareas.filter(t => t.periodo === pAct);
    const tCot = tP.filter(t => t.tipo === 'c');
    const tInt = tP.filter(t => t.tipo === 'i');
    const tExa = tP.filter(t => t.tipo === 'e');

    document.getElementById('tabla-cuerpo').innerHTML = grado.alumnos.map((al, idx) => {
        const d    = obtenerCalculos(al, tP);
        const notas = al.notas || {};
        const bono  = (al.puntos_extra || {})[pAct] || { c: 0, i: 0, e: 0 };
        const recup = (al.recuperacion || {})[pAct] || null;
        const nf   = parseFloat(d.r.notaFinal);
        const colorF = nf >= 7 ? 'text-emerald-600' : (nf >= 6 ? 'text-orange-500' : 'text-red-600');

        const partes = al.nombre.split(',');
        const ap  = (partes[0] || '').trim();
        const nom = (partes[1] || '').trim();

        // Badge de recuperación en la fila
        const badgeRecup = d.esRecuperacion
            ? `<span class="ml-1 text-[8px] bg-amber-100 text-amber-700 border border-amber-300 px-1 py-0.5 rounded-full font-black uppercase">RECUP</span>`
            : '';

        return `
        <tr class="hover:bg-slate-50 border-b border-slate-100">
            <td class="p-4 text-center font-bold text-slate-300 text-[10px]">${idx + 1}</td>
            <td class="p-4 font-black text-[10px] uppercase text-slate-800">${ap}</td>
            <td class="p-4 text-[10px] uppercase text-slate-500 font-medium">${nom}</td>
            <td class="p-4 text-center font-bold text-[10px] ${d.pC >= 6 ? 'text-emerald-500' : 'text-red-400'}">${d.pC.toFixed(1)}</td>
            <td class="p-4 text-center font-bold text-[10px] ${d.pI >= 6 ? 'text-emerald-500' : 'text-red-400'}">${d.pI.toFixed(1)}</td>
            <td class="p-4 text-center font-bold text-[10px] ${d.nE >= 6 ? 'text-emerald-500' : 'text-red-400'}">${d.nE.toFixed(1)}</td>
            <td class="p-4 text-center font-black bg-slate-50/50 text-base italic underline ${colorF}">${d.r.notaFinal}${badgeRecup}</td>
            <td class="p-4 text-center">
                <button onclick="toggleDetalle('${al.id}')" class="text-blue-600 bg-blue-50 w-8 h-8 rounded-full shadow-sm hover:bg-blue-100">
                    <i class="fas fa-star text-xs"></i>
                </button>
            </td>
        </tr>
        <tr id="detalle-${al.id}" class="${detallesAbiertos.has(al.id) ? '' : 'hidden'} bg-slate-50">
            <td colspan="8" class="p-6">

                <!-- BOTÓN DE RECUPERACIÓN -->
                <div class="mb-4 p-3 rounded-2xl border ${d.esRecuperacion ? 'bg-amber-50 border-amber-300' : 'bg-slate-100 border-slate-200'} flex flex-wrap gap-3 items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-redo text-amber-600 text-xs"></i>
                        <span class="text-[10px] font-black text-slate-700 uppercase tracking-wide">Recuperación Período ${pAct}</span>
                        ${d.esRecuperacion ? `<span class="text-[9px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-black">ACTIVA — notas originales reemplazadas</span>` : ''}
                    </div>
                    <div class="flex gap-2">
                        <button onclick="abrirModalRecuperacion('${al.id}')"
                            class="text-[9px] font-black uppercase px-3 py-1.5 rounded-xl transition-all ${d.esRecuperacion ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300'}">
                            <i class="fas fa-redo mr-1"></i>${d.esRecuperacion ? 'Editar recuperación' : 'Ingresar recuperación'}
                        </button>
                        ${d.esRecuperacion ? `
                        <button onclick="quitarRecuperacion('${al.id}')"
                            class="text-[9px] font-black uppercase px-3 py-1.5 rounded-xl bg-white text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 transition-all">
                            <i class="fas fa-times mr-1"></i>Quitar
                        </button>` : ''}
                    </div>
                </div>

                <!-- PUNTOS EXTRA (solo si no hay recuperación activa) -->
                ${!d.esRecuperacion ? `
                <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex flex-wrap gap-4 items-center">
                    <span class="text-[10px] font-black text-amber-700">
                        <i class="fas fa-trophy mr-1"></i> PUNTOS EXTRA PERIODO ${pAct}:
                    </span>
                    ${[
                        { key: 'c', label: 'Cot.' },
                        { key: 'i', label: 'Int.' },
                        { key: 'e', label: 'Exa.' },
                        { key: 'f', label: 'Final' }
                    ].map(({ key, label }) => `
                        <div class="flex items-center gap-1">
                            <label class="text-[9px] font-bold uppercase text-amber-600">${label}</label>
                            <input type="number" step="0.1" min="0" max="2" placeholder="0.0"
                                value="${bono[key] || ''}"
                                onchange="guardarPuntoExtra('${al.id}', '${key}', this.value)"
                                class="w-14 text-center border border-amber-300 rounded-lg text-[10px] font-bold bg-white p-1">
                        </div>
                    `).join('')}
                </div>` : ''}

                <!-- NOTAS POR TIPO (solo si no hay recuperación activa) -->
                ${!d.esRecuperacion ? `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    ${[
                        { tipo: 'c', tareas: tCot, label: 'Cotidianas',   color: 'emerald' },
                        { tipo: 'i', tareas: tInt, label: 'Integradoras', color: 'orange'  },
                        { tipo: 'e', tareas: tExa, label: 'Examen',       color: 'purple'  }
                    ].map(({ tipo, tareas, label, color }) => `
                        <div class="bg-white p-4 rounded-2xl border border-slate-200">
                            <h4 class="text-[9px] font-black uppercase mb-3 text-slate-400">${label}</h4>
                            ${tareas.length === 0
                                ? `<p class="text-[9px] text-slate-300 italic">Sin tareas asignadas</p>`
                                : tareas.map(t => `
                                    <div class="flex justify-between items-center text-[11px] mb-2 gap-2">
                                        <span class="flex-1 truncate text-slate-600">${t.nombre}</span>
                                        <input type="number" step="0.1" min="0" max="10"
                                            value="${notas[t.id] !== undefined ? notas[t.id] : ''}"
                                            placeholder="0"
                                            onchange="guardarNota('${al.id}', '${t.id}', this.value)"
                                            class="w-12 text-center font-bold border border-slate-200 rounded-lg bg-slate-50 p-1 text-xs">
                                        <button onclick="editarTarea('${t.id}')"
                                            class="text-blue-300 hover:text-blue-500 text-[9px]" title="Editar tarea">
                                            <i class="fas fa-pen"></i>
                                        </button>
                                        <button onclick="eliminarTarea('${t.id}')"
                                            class="text-red-300 hover:text-red-500 text-[9px]" title="Eliminar tarea">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                `).join('')
                            }
                        </div>
                    `).join('')}
                </div>` : `
                <!-- RESUMEN DE RECUPERACIÓN ACTIVA -->
                <div class="grid grid-cols-3 gap-4">
                    ${[
                        { key: 'c', label: 'Cotidiana', color: 'emerald' },
                        { key: 'i', label: 'Integradora', color: 'orange' },
                        { key: 'e', label: 'Examen', color: 'purple' }
                    ].map(({ key, label, color }) => `
                        <div class="bg-white p-4 rounded-2xl border border-${color}-200 text-center">
                            <p class="text-[9px] font-black uppercase text-slate-400 mb-1">${label}</p>
                            <p class="text-2xl font-black text-${color}-600">${recup?.[key] !== '' && recup?.[key] !== undefined ? recup[key] : '—'}</p>
                            <p class="text-[8px] text-slate-400 mt-1">máx. 7</p>
                        </div>
                    `).join('')}
                </div>`}

                <!-- ACCIONES DEL ALUMNO -->
                <div class="mt-4 flex justify-between items-center">
                    <div class="flex gap-2">
                        <button onclick="moverAlumno('${al.id}', -1)"
                            class="text-[9px] text-slate-400 hover:text-slate-700 font-bold border border-slate-200 hover:border-slate-400 px-3 py-1 rounded-full transition-all"
                            title="Subir en la lista">
                            <i class="fas fa-arrow-up mr-1"></i>Subir
                        </button>
                        <button onclick="moverAlumno('${al.id}', 1)"
                            class="text-[9px] text-slate-400 hover:text-slate-700 font-bold border border-slate-200 hover:border-slate-400 px-3 py-1 rounded-full transition-all"
                            title="Bajar en la lista">
                            <i class="fas fa-arrow-down mr-1"></i>Bajar
                        </button>
                        <button onclick="editarAlumno('${al.id}')"
                            class="text-[9px] text-blue-400 hover:text-blue-600 font-bold border border-blue-200 hover:border-blue-400 px-3 py-1 rounded-full transition-all">
                            <i class="fas fa-pen mr-1"></i>Editar Nombre
                        </button>
                    </div>
                    <button onclick="eliminarAlumno('${al.id}')"
                        class="text-[9px] text-red-400 hover:text-red-600 font-bold uppercase border border-red-200 hover:border-red-400 px-3 py-1 rounded-full transition-all">
                        <i class="fas fa-trash mr-1"></i>Eliminar
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ─────────────────────────────────────────────
//  REPORTE
// ─────────────────────────────────────────────
window.generarReporte = () => {
    const grado = gradosCache[gIdx];
    if (!grado) return;

    const tP   = grado.tareas.filter(t => t.periodo === pAct);
    const tCot = tP.filter(t => t.tipo === 'c');
    const tInt = tP.filter(t => t.tipo === 'i');

    const alOrdenados = [...grado.alumnos].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
    );

    const filas = alOrdenados.map((al, idx) => {
        const d     = obtenerCalculos(al, tP);
        const notas = al.notas || {};
        const esR   = d.esRecuperacion;
        return `
        <tr>
            <td class="border border-black text-center p-1">${idx + 1}</td>
            <td class="border border-black p-1 uppercase font-bold text-left">${al.nombre}${esR ? ' <span style="font-size:7px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:4px;font-weight:900">RECUP</span>' : ''}</td>
            ${tCot.map(t => `<td class="border border-black text-center p-1">${esR ? '—' : (notas[t.id] !== undefined ? notas[t.id] : '-')}</td>`).join('')}
            <td class="border border-black text-center font-black bg-emerald-50 p-1">${d.pC.toFixed(1)}</td>
            ${tInt.map(t => `<td class="border border-black text-center p-1">${esR ? '—' : (notas[t.id] !== undefined ? notas[t.id] : '-')}</td>`).join('')}
            <td class="border border-black text-center font-black bg-orange-50 p-1">${d.pI.toFixed(1)}</td>
            <td class="border border-black text-center p-1">${esR ? '—' : d.baseExamen.toFixed(1)}</td>
            <td class="border border-black text-center font-black bg-purple-50 p-1">${d.nE.toFixed(1)}</td>
            <td class="border border-black text-center font-black text-xs bg-slate-100 p-1 ${parseFloat(d.r.notaFinal) >= 6 ? 'text-emerald-700' : 'text-red-600'}">${d.r.notaFinal}</td>
        </tr>`;
    }).join('');

    const aprobados  = alOrdenados.filter(al => parseFloat(obtenerCalculos(al, tP).r.notaFinal) >= 6).length;
    const reprobados = alOrdenados.length - aprobados;

    document.getElementById('reporte-contenido').innerHTML = `
        <div class="text-center mb-6">
            <p class="text-[10px] text-slate-400 uppercase font-bold">${esc(ajustes?.institucion || '')}</p>
            <h1 class="text-xl font-black uppercase border-b-2 border-black pb-2 mt-1">Registro de Calificaciones ${esc(ajustes?.anio || '')}</h1>
            <h2 class="text-lg font-bold mt-2 uppercase text-blue-900">${grado.nombre} — PERIODO ${pAct}</h2>
            ${ajustes?.docente ? `<p class="text-[10px] text-slate-500 mt-1 uppercase font-bold">Docente: ${esc(ajustes.docente)}</p>` : ''}
            <p class="text-[10px] text-slate-500 mt-1">Generado: ${new Date().toLocaleDateString('es-SV', { dateStyle: 'long' })}</p>
        </div>
        <table class="w-full text-[9px] border-collapse border border-black">
            <thead>
                <tr class="bg-slate-100">
                    <th rowspan="2" class="border border-black p-1">Nº</th>
                    <th rowspan="2" class="border border-black p-1 text-left min-w-[120px]">APELLIDOS Y NOMBRES</th>
                    <th colspan="${tCot.length + 1}" class="border border-black p-1 bg-emerald-50">COTIDIANAS (35%)</th>
                    <th colspan="${tInt.length + 1}" class="border border-black p-1 bg-orange-50">INTEGRADORAS (35%)</th>
                    <th colspan="2"                  class="border border-black p-1 bg-purple-50">EXAMEN (30%)</th>
                    <th rowspan="2"                  class="border border-black p-1 bg-slate-200">FINAL</th>
                </tr>
                <tr class="text-[8px]">
                    ${tCot.map((t, i) => `<th class="border border-black p-1" title="${t.nombre}">C${i+1}</th>`).join('')}
                    <th class="border border-black p-1 font-bold italic bg-emerald-100">Prom.</th>
                    ${tInt.map((t, i) => `<th class="border border-black p-1" title="${t.nombre}">I${i+1}</th>`).join('')}
                    <th class="border border-black p-1 font-bold italic bg-orange-100">Prom.</th>
                    <th class="border border-black p-1">Base</th>
                    <th class="border border-black p-1 font-bold italic bg-purple-100">+Bono</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
        <div class="mt-4 flex gap-8 text-[10px] font-bold">
            <span>Total alumnos: <b>${alOrdenados.length}</b></span>
            <span class="text-emerald-700">Aprobados: <b>${aprobados}</b></span>
            <span class="text-red-600">Reprobados: <b>${reprobados}</b></span>
        </div>
        <div class="mt-8 grid grid-cols-3 gap-8 text-center text-[10px] pt-8">
            <div class="border-t border-black pt-2"><p class="font-bold uppercase">Docente</p></div>
            <div class="border-t border-black pt-2"><p class="font-bold uppercase">Coordinador/a</p></div>
            <div class="border-t border-black pt-2"><p class="font-bold uppercase">Director/a</p></div>
        </div>
    `;

    mostrarVista('vista-reporte');
};

window.cerrarReporte = () => {
    mostrarVista('vista-detalle-grado');
};

// ─────────────────────────────────────────────
//  AJUSTES (reemplaza al login: la app es del docente que la instaló)
// ─────────────────────────────────────────────
window.abrirAjustes = () => {
    const primeraVez = !ajustes;
    document.getElementById('ajustes-docente').value     = ajustes?.docente || '';
    document.getElementById('ajustes-institucion').value = ajustes?.institucion || '';
    document.getElementById('ajustes-anio').value        = ajustes?.anio || new Date().getFullYear();
    document.getElementById('ajustes-titulo').textContent = primeraVez ? 'Bienvenido a Gradus' : 'Ajustes';
    document.getElementById('ajustes-volver').classList.toggle('hidden', primeraVez);
    document.getElementById('ajustes-error').classList.add('hidden');
    mostrarVista('vista-ajustes');
};

window.guardarAjustesForm = async () => {
    const docente     = document.getElementById('ajustes-docente').value.trim();
    const institucion = document.getElementById('ajustes-institucion').value.trim();
    const anio        = document.getElementById('ajustes-anio').value.trim();
    const errEl       = document.getElementById('ajustes-error');
    if (!docente || !institucion || !anio) {
        errEl.textContent = 'Completá los tres campos';
        errEl.classList.remove('hidden');
        return;
    }
    ajustes = { docente, institucion, anio };
    await db.guardarAjustes(ajustes);
    mostrarGrados();
};

// ─────────────────────────────────────────────
//  RESPALDO (exportar / importar)
// ─────────────────────────────────────────────
window.exportarRespaldo = async () => {
    const datos = await db.exportarTodo();
    const blob  = new Blob([JSON.stringify(datos)], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `gradus-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

window.importarRespaldo = (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const datos = JSON.parse(e.target.result);
            db.validarRespaldo(datos);
            const n = datos.grados.length;
            if (!confirm(`Este respaldo tiene ${n} grado(s).\n\nSe REEMPLAZARÁ todo lo que hay ahora en este dispositivo. ¿Continuar?`)) return;
            const r = await db.importarTodo(datos);
            ajustes = await db.leerAjustes();
            alert(`✅ Respaldo cargado: ${r.grados} grados, ${r.alumnos} alumnos, ${r.tareas} actividades, ${r.anecdotico} registros anecdóticos.`);
            if (ajustes) mostrarGrados(); else abrirAjustes();
        } catch (err) {
            alert('No se pudo cargar el respaldo: ' + err.message);
        }
    };
    reader.readAsText(file);
};

// ─────────────────────────────────────────────
//  INICIO
// ─────────────────────────────────────────────
(async () => {
    ajustes = await db.leerAjustes();
    if (ajustes) {
        mostrarGrados();
    } else {
        abrirAjustes();
    }
})();

// ─────────────────────────────────────────────
//  EDICIÓN DE TAREAS Y ALUMNOS
// ─────────────────────────────────────────────
window.editarTarea = async (tId) => {
    const tarea = gradosCache[gIdx].tareas.find(t => t.id === tId);
    if (!tarea) return;
    const nuevoNombre = prompt('Nombre de la tarea:', tarea.nombre);
    if (nuevoNombre === null) return;
    if (!nuevoNombre.trim()) return alert('El nombre no puede estar vacío');
    const opciones = { c: 'Cotidiana', i: 'Integradora', e: 'Examen' };
    const nuevoTipoStr = prompt(
        `Tipo actual: ${opciones[tarea.tipo]}\nEscribí la letra del nuevo tipo:\n  c = Cotidiana\n  i = Integradora\n  e = Examen`,
        tarea.tipo
    );
    if (nuevoTipoStr === null) return;
    const nuevoTipo = nuevoTipoStr.trim().toLowerCase();
    if (!['c', 'i', 'e'].includes(nuevoTipo)) return alert('Tipo inválido. Usá c, i o e.');
    await db.actualizar('tareas', tId, { nombre: nuevoNombre.trim().toUpperCase(), tipo: nuevoTipo });
    tarea.nombre = nuevoNombre.trim().toUpperCase();
    tarea.tipo   = nuevoTipo;
    renderDetalle();
};

window.editarAlumno = async (alId) => {
    const al = gradosCache[gIdx].alumnos.find(a => a.id === alId);
    if (!al) return;
    const nuevoNombre = prompt('Nombre del alumno (APELLIDOS, NOMBRES):', al.nombre);
    if (nuevoNombre === null) return;
    if (!nuevoNombre.trim()) return alert('El nombre no puede estar vacío');
    await db.actualizar('alumnos', alId, { nombre: nuevoNombre.trim().toUpperCase() });
    al.nombre = nuevoNombre.trim().toUpperCase();
    renderDetalle();
};

window.moverAlumno = (alId, direccion) => {
    const lista = gradosCache[gIdx].alumnos;
    const idx   = lista.findIndex(a => a.id === alId);
    if (idx === -1) return;
    const nuevoIdx = idx + direccion;
    if (nuevoIdx < 0 || nuevoIdx >= lista.length) return;
    [lista[idx], lista[nuevoIdx]] = [lista[nuevoIdx], lista[idx]];
    lista.forEach((a, i) => { a.orden_manual = i; });
    lista.forEach(a => db.actualizar('alumnos', a.id, { orden_manual: a.orden_manual }));
    renderDetalle();
};

// ─────────────────────────────────────────────
//  ANECDÓTICO
// ─────────────────────────────────────────────
let anecGradoId = null;
let anecPeriodo = 1;

const TIPO_CONFIG = {
    positivo:   { emoji: '👍', label: 'Positivo',            bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
    negativo:   { emoji: '👎', label: 'Negativo',            bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700'     },
    atencion:   { emoji: '⚠️', label: 'Llamada de atención', bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700'   },
    compromiso: { emoji: '🤝', label: 'Compromiso/Acuerdo',  bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700'    },
    neutral:    { emoji: '📋', label: 'Observación neutral', bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-700'   },
};

window.abrirAnecdotico = async (gradoId) => {
    const grado = gradosCache.find(g => g.id === gradoId);
    if (!grado) return;
    anecGradoId = gradoId;
    if (!grado.alumnos) {
        grado.alumnos = await db.porGrado('alumnos', gradoId);
    }
    const sel = document.getElementById('anec-alumno');
    sel.innerHTML = '<option value="">— Seleccionar alumno —</option>' +
        [...grado.alumnos]
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
            .map(a => `<option value="${a.id}">${a.nombre}</option>`)
            .join('');
    document.getElementById('anec-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('anec-descripcion').value = '';
    document.getElementById('titulo-anecdotico').innerText = grado.nombre;
    mostrarVista('vista-anecdotico');
    setPeriodoAnec(1);
};

window.setPeriodoAnec = async (n) => {
    anecPeriodo = n;
    document.querySelectorAll('#selector-periodos-anec button').forEach((b, i) => {
        b.className = (i + 1 === n)
            ? 'px-4 py-1 rounded-md font-bold text-xs bg-white text-violet-900 shadow-sm'
            : 'px-4 py-1 rounded-md font-bold text-xs text-violet-300';
    });
    await renderAnecdotico();
};

window.guardarRegistroAnec = async () => {
    const alId  = document.getElementById('anec-alumno').value;
    const tipo  = document.getElementById('anec-tipo').value;
    const fecha = document.getElementById('anec-fecha').value;
    const desc  = document.getElementById('anec-descripcion').value.trim();
    if (!alId)  return alert('Seleccioná un alumno');
    if (!fecha) return alert('Seleccioná una fecha');
    if (!desc)  return alert('Escribí una descripción');
    await db.insertar('anecdotico', {
        grado_id: anecGradoId, alumno_id: alId, tipo, fecha, descripcion: desc, periodo: anecPeriodo
    });
    document.getElementById('anec-descripcion').value = '';
    document.getElementById('anec-alumno').value = '';
    await renderAnecdotico();
};

window.eliminarRegistroAnec = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return;
    await db.borrar('anecdotico', id);
    await renderAnecdotico();
};

// Registros del grado y periodo, con el nombre del alumno (antes era un join de Supabase)
async function cargarRegistrosAnec(ascendente) {
    const grado = gradosCache.find(g => g.id === anecGradoId);
    const nombres = Object.fromEntries((grado?.alumnos || []).map(a => [a.id, a.nombre]));
    const registros = (await db.porGrado('anecdotico', anecGradoId))
        .filter(r => r.periodo === anecPeriodo)
        .map(r => ({ ...r, alumnos: { nombre: nombres[r.alumno_id] || '' } }));
    registros.sort((a, b) => ascendente ? a.fecha.localeCompare(b.fecha) : b.fecha.localeCompare(a.fecha));
    return registros;
}

async function renderAnecdotico() {
    const registros = await cargarRegistrosAnec(false);
    const lista = document.getElementById('lista-anecdotico');
    if (!registros || registros.length === 0) {
        lista.innerHTML = `
            <div class="col-span-3 text-center py-16 text-slate-300">
                <i class="fas fa-book-open text-4xl mb-4 block"></i>
                <p class="font-bold text-sm">Sin registros en este periodo</p>
                <p class="text-xs mt-1">Agregá el primero desde el formulario</p>
            </div>`;
        return;
    }
    lista.innerHTML = registros.map(r => {
        const cfg = TIPO_CONFIG[r.tipo] || TIPO_CONFIG.neutral;
        const fechaFmt = new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-SV', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        return `
        <div class="${cfg.bg} border ${cfg.border} rounded-2xl p-4 flex gap-4 items-start shadow-sm">
            <span class="text-2xl mt-0.5 select-none">${cfg.emoji}</span>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start gap-2 flex-wrap">
                    <div>
                        <span class="font-black text-xs uppercase text-slate-800">${r.alumnos?.nombre || 'Alumno desconocido'}</span>
                        <span class="ml-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}">${cfg.label}</span>
                    </div>
                    <span class="text-[9px] text-slate-400 font-bold capitalize whitespace-nowrap">
                        <i class="fas fa-calendar mr-1"></i>${fechaFmt}
                    </span>
                </div>
                <p class="text-sm text-slate-600 mt-2 leading-relaxed">${esc(r.descripcion)}</p>
            </div>
            <button onclick="eliminarRegistroAnec('${r.id}')"
                class="text-slate-300 hover:text-red-400 transition-colors mt-0.5 flex-shrink-0" title="Eliminar">
                <i class="fas fa-times"></i>
            </button>
        </div>`;
    }).join('');
}

window.imprimirAnecdotico = async () => {
    const grado = gradosCache.find(g => g.id === anecGradoId);
    const registros = await cargarRegistrosAnec(true);
    const filas = (registros || []).map((r, i) => {
        const cfg = TIPO_CONFIG[r.tipo] || TIPO_CONFIG.neutral;
        const fechaFmt = new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-SV', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
        return `
        <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:6px;text-align:center;font-size:10px">${i + 1}</td>
            <td style="padding:6px;font-size:10px;font-weight:700;text-transform:uppercase">${r.alumnos?.nombre || ''}</td>
            <td style="padding:6px;text-align:center;font-size:11px">${cfg.emoji} ${cfg.label}</td>
            <td style="padding:6px;font-size:10px;text-align:center">${fechaFmt}</td>
            <td style="padding:6px;font-size:10px">${esc(r.descripcion)}</td>
        </tr>`;
    }).join('');
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>Anecdótico - ${grado?.nombre}</title>
        <style>body{font-family:sans-serif;padding:24px} table{width:100%;border-collapse:collapse} th{background:#1e1b4b;color:white;padding:8px;font-size:10px;text-transform:uppercase} @media print{button{display:none}}</style>
        </head><body>
        <div style="text-align:center;margin-bottom:16px">
            <p style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:700">${esc(ajustes?.institucion || '')}</p>
            <h1 style="font-size:18px;font-weight:900;margin:4px 0">Registro Anecdótico ${esc(ajustes?.anio || '')}</h1>
            <h2 style="font-size:14px;font-weight:700;color:#1e1b4b">${grado?.nombre} — Periodo ${anecPeriodo}</h2>
        </div>
        <table>
            <thead><tr>
                <th>Nº</th><th>Alumno</th><th>Tipo</th><th>Fecha</th><th>Descripción</th>
            </tr></thead>
            <tbody>${filas}</tbody>
        </table>
        <br><button onclick="window.print()">🖨 Imprimir</button>
        </body></html>
    `);
    win.document.close();
};
