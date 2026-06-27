/**
 * Non-Negative Least Squares (NNLS) solver.
 * Ported from nnls.c (Lawson-Hanson, 1974).
 * Solves: min ||A·x - b|| subject to x >= 0.
 */
'use strict';

const NNLS = (() => {

    // ── Givens rotation ──
    function g1(a, b) {
        if (Math.abs(a) > Math.abs(b)) {
            const xr = b / a;
            const d = Math.sqrt(xr * xr + 1);
            const cterm = (a >= 0 ? 1 : -1) / d;
            return { cterm, sterm: cterm * xr, sig: Math.abs(a) * d };
        }
        if (b !== 0) {
            const xr = a / b;
            const d = Math.sqrt(xr * xr + 1);
            const sterm = (b >= 0 ? 1 : -1) / d;
            return { cterm: sterm * xr, sterm, sig: Math.abs(b) * d };
        }
        return { cterm: 0, sterm: 1, sig: 0 };
    }

    // ── Householder transformation ──
    // u-column lives in `a` at uOffset; c-column(s) live in `c` at cOffset.
    // ice = row stride within c (1=vector, mda=column of matrix)
    // icv = column stride within c (mda for matrix, 1 for vector)
    // ncv = 0 means construct only, no application.
    function h12(mode, lpivot, l1, m, a, uOffset, up, c, cOffset, ice, icv, ncv) {
        if (lpivot < 0 || lpivot >= l1 || l1 > m) return;
        const cl0 = Math.abs(a[uOffset + lpivot]);

        if (mode === 1) {
            let cl = cl0;
            for (let j = l1; j < m; j++) cl = Math.max(Math.abs(a[uOffset + j]), cl);
            if (cl <= 0) return;

            const clinv = 1 / cl;
            let sm = (a[uOffset + lpivot] * clinv) ** 2;
            for (let j = l1; j < m; j++) sm += (a[uOffset + j] * clinv) ** 2;
            cl *= Math.sqrt(sm);
            if (a[uOffset + lpivot] > 0) cl = -cl;
            up[0] = a[uOffset + lpivot] - cl;
            a[uOffset + lpivot] = cl;
        } else if (cl0 <= 0) {
            return;
        }

        if (ncv <= 0) return;

        const ub = up[0] * a[uOffset + lpivot];
        if (ub >= 0) return;
        const ubInv = 1 / ub;

        for (let j = 0; j < ncv; j++) {
            const colBase = cOffset + j * icv;
            let dot = c[colBase + lpivot * ice] * up[0];
            for (let i = l1; i < m; i++) dot += c[colBase + i * ice] * a[uOffset + i];
            if (dot !== 0) {
                dot *= ubInv;
                c[colBase + lpivot * ice] += dot * up[0];
                for (let i = l1; i < m; i++) c[colBase + i * ice] += dot * a[uOffset + i];
            }
        }
    }

    // ── Triangular back-substitution ──
    function solveTriangular(nsetp, a, mda, index, b, zz) {
        for (let l = 0; l < nsetp; l++) {
            const ip = nsetp - 1 - l;
            if (l > 0) {
                for (let ii = 0; ii <= ip; ii++) {
                    zz[ii] -= a[ii + index[ip + 1] * mda] * zz[ip + 1];
                }
            }
            zz[ip] /= a[ip + index[ip] * mda];
        }
    }

    // ── Main NNLS solver ──
    // a: m×n matrix (column-major, modified in-place)
    // mda: leading dimension of a (≥ m)
    // b: right-hand side (length m, modified in-place)
    // x: output solution (length n)
    // Returns 1=success, 2=bad dims, 3=max iterations
    function nnls(a, mda, m, n, b, x, w, zz, index) {
        if (m <= 0 || n <= 0) return 2;

        w = w || new Float32Array(n);
        zz = zz || new Float32Array(m);
        index = index || new Int32Array(n);

        let iter = 0, itmax = n * 3;
        for (let i = 0; i < n; i++) { x[i] = 0; index[i] = i; }
        let iz1 = 0, iz2 = n, nsetp = 0, npp1 = 0;

        // ── Main loop (L30) ──
        while (iz1 < iz2 && nsetp < m) {
            // Compute dual vector w for the inactive set
            for (let iz = iz1; iz < iz2; iz++) {
                const j = index[iz];
                let sm = 0;
                for (let l = npp1; l < m; l++) sm += a[l + j * mda] * b[l];
                w[j] = sm;
            }

            // ── Inner loop (L60): wmax search + acceptance ──
            // rejection goes back to wmax search WITHOUT recomputing w
            let wmax = 0;
            inner: while (true) {
                wmax = 0;
                let izmax = iz1;
                for (let iz = iz1; iz < iz2; iz++) {
                    if (w[index[iz]] > wmax) { wmax = w[index[iz]]; izmax = iz; }
                }
                if (wmax <= 0) break; // KKT satisfied

                const j = index[izmax];
                const asave = a[npp1 + j * mda];
                const upArr = [0];

                // Construct Householder transformation on column j
                h12(1, npp1, npp1 + 1, m, a, j * mda, upArr, a, j * mda, 1, 1, 0);
                const up = upArr[0];

                // Check near-linear dependence
                let unorm = 0;
                for (let l = 0; l < nsetp; l++) unorm += a[l + j * mda] ** 2;
                unorm = Math.sqrt(unorm);

                let accepted = false;
                if (unorm + Math.abs(a[npp1 + j * mda]) * 0.01 - unorm > 0) {
                    // Copy b → zz, apply Householder to zz, compute ztest
                    for (let l = 0; l < m; l++) zz[l] = b[l];
                    h12(2, npp1, npp1 + 1, m, a, j * mda, [up], zz, 0, 1, 1, 1);
                    const ztest = zz[npp1] / a[npp1 + j * mda];

                    if (ztest > 0) {
                        // Accept into active set (L140)
                        for (let l = 0; l < m; l++) b[l] = zz[l];

                        const tmp = index[iz1];
                        index[iz1] = index[izmax];
                        index[izmax] = tmp;
                        iz1++;
                        nsetp = npp1;
                        npp1++;

                        // Apply Householder to remaining inactive columns
                        for (let jz = iz1; jz < iz2; jz++) {
                            h12(2, nsetp, npp1, m, a, j * mda, [up],
                                a, index[jz] * mda, 1, mda, 1);
                        }
                        if (nsetp < m) {
                            for (let l = npp1; l < m; l++) a[l + j * mda] = 0;
                        }
                        w[j] = 0;
                        solveTriangular(nsetp, a, mda, index, b, zz);
                        accepted = true;
                    }
                }

                if (!accepted) {
                    a[npp1 + j * mda] = asave;
                    w[j] = 0;
                    continue; // back to wmax search (goto L60)
                }

                // ── Secondary loop (L210): enforce non-negativity ──
                while (true) {
                    if (++iter > itmax) return 3;

                    let alpha = 2, jj = -1;
                    for (let ip = 0; ip < nsetp; ip++) {
                        const l = index[ip];
                        if (zz[ip] <= 0) {
                            const t = -x[l] / (zz[ip] - x[l]);
                            if (alpha > t) { alpha = t; jj = ip; }
                        }
                    }
                    if (alpha === 2) break; // all feasible

                    for (let ip = 0; ip < nsetp; ip++) {
                        x[index[ip]] += alpha * (zz[ip] - x[index[ip]]);
                    }

                    // Move infeasible coefficient from P → Z
                    let ii = index[jj];
                    x[ii] = 0;
                    while (jj !== nsetp - 1) {
                        jj++;
                        ii = index[jj];
                        index[jj - 1] = ii;
                        const g = g1(a[jj - 1 + ii * mda], a[jj + ii * mda]);
                        a[jj - 1 + ii * mda] = g.sig;
                        a[jj + ii * mda] = 0;
                        for (let l = 0; l < n; l++) {
                            if (l !== ii) {
                                const tmp = a[jj - 1 + l * mda];
                                a[jj - 1 + l * mda] = g.cterm * tmp + g.sterm * a[jj + l * mda];
                                a[jj + l * mda] = -g.sterm * tmp + g.cterm * a[jj + l * mda];
                            }
                        }
                        const tmp = b[jj - 1];
                        b[jj - 1] = g.cterm * tmp + g.sterm * b[jj];
                        b[jj] = -g.sterm * tmp + g.cterm * b[jj];
                    }

                    npp1 = nsetp;
                    nsetp--;
                    iz1--;
                    index[iz1] = ii;

                    // Re-check remaining P-set coefficients
                    let reSolve = false;
                    for (let jj2 = 0; jj2 < nsetp; jj2++) {
                        if (x[index[jj2]] <= 0) {
                            ii = index[jj2];
                            x[ii] = 0;
                            let jj = jj2;
                            while (jj !== nsetp - 1) {
                                jj++;
                                ii = index[jj];
                                index[jj - 1] = ii;
                                const g = g1(a[jj - 1 + ii * mda], a[jj + ii * mda]);
                                a[jj - 1 + ii * mda] = g.sig;
                                a[jj + ii * mda] = 0;
                                for (let l = 0; l < n; l++) {
                                    if (l !== ii) {
                                        const tmp = a[jj - 1 + l * mda];
                                        a[jj - 1 + l * mda] = g.cterm * tmp + g.sterm * a[jj + l * mda];
                                        a[jj + l * mda] = -g.sterm * tmp + g.cterm * a[jj + l * mda];
                                    }
                                }
                                const tmp = b[jj - 1];
                                b[jj - 1] = g.cterm * tmp + g.sterm * b[jj];
                                b[jj] = -g.sterm * tmp + g.cterm * b[jj];
                            }
                            npp1 = nsetp;
                            nsetp--;
                            iz1--;
                            index[iz1] = ii;
                            reSolve = true;
                            break;
                        }
                    }
                    if (reSolve) continue;

                    for (let l = 0; l < m; l++) zz[l] = b[l];
                    solveTriangular(nsetp, a, mda, index, b, zz);
                }

                // Copy zz → x (L330)
                for (let ip = 0; ip < nsetp; ip++) x[index[ip]] = zz[ip];
                break inner; // → main loop, recompute w
            }
            if (wmax <= 0) break; // (L350)
        }

        // Residual norm
        let sm = 0;
        for (let i = npp1; i < m; i++) sm += b[i] * b[i];
        return 1;
    }

    return { nnls };
})();
