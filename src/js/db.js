// ─────────────────────────────────────────────
//  ALMACENAMIENTO LOCAL (IndexedDB)
//  Reemplaza a Supabase: todo se guarda en el dispositivo.
// ─────────────────────────────────────────────
const DB_NOMBRE  = 'gradus';
const DB_VERSION = 1;
export const TABLAS = ['grados', 'alumnos', 'tareas', 'anecdotico'];

let conexion = null;

function abrir() {
    if (conexion) return conexion;
    conexion = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore('grados', { keyPath: 'id' });
            for (const nombre of ['alumnos', 'tareas', 'anecdotico']) {
                const store = db.createObjectStore(nombre, { keyPath: 'id' });
                store.createIndex('grado_id', 'grado_id');
            }
            db.createObjectStore('ajustes', { keyPath: 'clave' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
    // Pedir al navegador que no borre los datos por falta de espacio
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    return conexion;
}

// Ejecuta una operación dentro de una transacción y espera a que termine
async function enTransaccion(stores, modo, operacion) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, modo);
        let resultado;
        tx.oncomplete = () => resolve(resultado);
        tx.onerror    = () => reject(tx.error);
        tx.onabort    = () => reject(tx.error);
        const valor = operacion(tx);
        if (valor && 'onsuccess' in valor) {
            valor.onsuccess = () => { resultado = valor.result; };
        } else {
            resultado = valor;
        }
    });
}

export function nuevoId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ── Lectura ──────────────────────────────────
export const todos = (tabla) =>
    enTransaccion(tabla, 'readonly', tx => tx.objectStore(tabla).getAll());

export const obtener = (tabla, id) =>
    enTransaccion(tabla, 'readonly', tx => tx.objectStore(tabla).get(id));

export const porGrado = (tabla, gradoId) =>
    enTransaccion(tabla, 'readonly', tx => tx.objectStore(tabla).index('grado_id').getAll(gradoId));

// ── Escritura ────────────────────────────────
export async function insertar(tabla, filas) {
    const lista = (Array.isArray(filas) ? filas : [filas]).map(f => ({ id: nuevoId(), ...f }));
    await enTransaccion(tabla, 'readwrite', tx => {
        const store = tx.objectStore(tabla);
        lista.forEach(f => store.put(f));
    });
    return lista;
}

export async function actualizar(tabla, id, cambios) {
    await enTransaccion(tabla, 'readwrite', tx => {
        const store = tx.objectStore(tabla);
        const req = store.get(id);
        req.onsuccess = () => {
            if (req.result) store.put({ ...req.result, ...cambios });
        };
    });
}

export const borrar = (tabla, id) =>
    enTransaccion(tabla, 'readwrite', tx => { tx.objectStore(tabla).delete(id); });

export const borrarPorGrado = (tabla, gradoId) =>
    enTransaccion(tabla, 'readwrite', tx => {
        const req = tx.objectStore(tabla).index('grado_id').openCursor(IDBKeyRange.only(gradoId));
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
        };
    });

// ── Ajustes (docente, institución, año) ──────
export async function leerAjustes() {
    const fila = await enTransaccion('ajustes', 'readonly', tx => tx.objectStore('ajustes').get('general'));
    return fila ? fila.valor : null;
}

export const guardarAjustes = (valor) =>
    enTransaccion('ajustes', 'readwrite', tx => { tx.objectStore('ajustes').put({ clave: 'general', valor }); });

// ── Respaldo ─────────────────────────────────
export async function exportarTodo() {
    const respaldo = {
        app: 'gradus',
        version: 1,
        exportado: new Date().toISOString(),
        ajustes: await leerAjustes()
    };
    for (const tabla of TABLAS) respaldo[tabla] = await todos(tabla);
    return respaldo;
}

export function validarRespaldo(datos) {
    if (!datos || datos.app !== 'gradus' || !Array.isArray(datos.grados)) {
        throw new Error('El archivo no es un respaldo de Gradus.');
    }
}

// Reemplaza TODO lo guardado por el contenido del respaldo
export async function importarTodo(datos) {
    validarRespaldo(datos);
    await enTransaccion([...TABLAS, 'ajustes'], 'readwrite', tx => {
        for (const tabla of TABLAS) {
            const store = tx.objectStore(tabla);
            store.clear();
            (datos[tabla] || []).forEach(fila => { if (fila && fila.id) store.put(fila); });
        }
        if (datos.ajustes) tx.objectStore('ajustes').put({ clave: 'general', valor: datos.ajustes });
    });
    const resumen = {};
    for (const tabla of TABLAS) resumen[tabla] = (datos[tabla] || []).length;
    return resumen;
}
