/**
 * GRADUS - Lógica de Cálculo
 * Sistema de notas El Salvador: 35% Cotidianas + 35% Integradoras + 30% Examen
 */

export function calcularPeriodo(promCotidiana, promIntegradora, notaExamen, bonoFinal = 0) {
    const pC = Math.min(10, Math.max(0, parseFloat(promCotidiana) || 0));
    const pI = Math.min(10, Math.max(0, parseFloat(promIntegradora) || 0));
    const nE = Math.min(10, Math.max(0, parseFloat(notaExamen) || 0));
    const bF = Math.max(0, parseFloat(bonoFinal) || 0);

    const base  = (pC * 0.35) + (pI * 0.35) + (nE * 0.30);
    const final = Math.min(10, base + bF);

    return {
        notaFinal: final.toFixed(1),
        aprobado: final >= 6.0
    };
}

export function promedioArreglo(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}