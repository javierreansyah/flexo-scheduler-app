#pragma once
#include "engine.h"
namespace flexo {
struct Xoshiro256pp {
    using result_type = uint64_t;
    uint64_t s[4];

    static constexpr result_type min() noexcept { return 0; }
    static constexpr result_type max() noexcept { return UINT64_MAX; }

    explicit Xoshiro256pp(uint64_t seed) noexcept {
        auto sm64 = [](uint64_t& x) noexcept -> uint64_t {
            uint64_t z = (x += 0x9e3779b97f4a7c15ULL);
            z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
            z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
            return z ^ (z >> 31);
        };
        s[0] = sm64(seed); s[1] = sm64(seed);
        s[2] = sm64(seed); s[3] = sm64(seed);
    }

    FLEXO_FORCE_INLINE result_type operator()() noexcept {
        const uint64_t result = rotl(s[0] + s[3], 23) + s[0];
        const uint64_t t = s[1] << 17;
        s[2] ^= s[0]; s[3] ^= s[1];
        s[1] ^= s[2]; s[0] ^= s[3];
        s[2] ^= t;
        s[3] = rotl(s[3], 45);
        return result;
    }

    FLEXO_FORCE_INLINE double next_double() noexcept {
        return (double)(operator()() >> 11) * 0x1.0p-53;
    }

    // Lemire's unbiased bounded integer sampling.
    FLEXO_FORCE_INLINE uint64_t bounded(uint64_t n) noexcept {
#ifdef _MSC_VER
        uint64_t hi, lo = _umul128((*this)(), n, &hi);
        if (lo < n) {
            uint64_t t = (uint64_t)(0u - n) % n;
            while (lo < t) { lo = _umul128((*this)(), n, &hi); }
        }
        return hi;
#else
        unsigned __int128 m = (unsigned __int128)(*this)() * n;
        uint64_t lo = (uint64_t)m;
        if (lo < n) {
            uint64_t t = (uint64_t)(0u - n) % n;
            while (lo < t) { m = (unsigned __int128)(*this)() * n; lo = (uint64_t)m; }
        }
        return (uint64_t)(m >> 64);
#endif
    }

private:
    static FLEXO_FORCE_INLINE uint64_t rotl(uint64_t x, int k) noexcept {
        return (x << k) | (x >> (64 - k));
    }
};

void apply_move_internal(
    std::vector<std::vector<int>>& schedule,
    const SAContext& ctx, SAWorkspace& ws, Xoshiro256pp& rng,
    MoveUndo& undo) {

    int n_m = ctx.num_machines;

    // Hierarchical selection
    bool is_block = rng.next_double() < ctx.p_B;
    int L = is_block ? (int)(2 + rng.bounded(std::max(1, ctx.B_max - 1))) : 1;
    bool is_shift = rng.next_double() < ctx.p_S;
    bool is_inter = rng.next_double() < ctx.p_I;

    // Pick source machine uniformly at random
    int mf = (int)rng.bounded((uint64_t)n_m);
    int m2 = mf;
    if (is_inter) {
        if (n_m <= 1) { undo.move_type = -1; return; }
        int raw = (int)rng.bounded((uint64_t)(n_m - 1));
        m2 = (raw >= mf) ? raw + 1 : raw;
    }

    undo.m1 = mf;
    undo.m2 = m2;
    auto& j1 = schedule[mf];
    auto& j2 = schedule[m2];

    auto rnd = [&](size_t lo, size_t hi) -> size_t {
        return lo + rng.bounded(hi - lo + 1);
    };

    if (is_block) {
        L = std::min(L, (int)j1.size());
        if (L < 2) { is_block = false; L = 1; }
    }

    if (!is_block) {
        // Single-job moves.
        if (is_shift) {
            if (is_inter) {
                // Inter-shift: move job from mf to m2
                if (j1.empty()) { undo.move_type = -1; return; }
                undo.move_type = 3;
                size_t i = rnd(0, j1.size()-1);
                int job = j1[i];
                j1.erase(j1.begin() + i);
                size_t pos = rnd(0, j2.size());
                j2.insert(j2.begin() + pos, job);
                undo.i1 = i; undo.i2 = pos;
            } else {
                // Intra-shift: relocate within mf
                if (j1.size() < 2) { undo.move_type = -1; return; }
                undo.move_type = 2;
                size_t i = rnd(0, j1.size()-1);
                int job = j1[i];
                j1.erase(j1.begin() + i);
                size_t pos = rnd(0, j1.size());
                j1.insert(j1.begin() + pos, job);
                undo.i1 = i; undo.i2 = pos;
            }
        } else {
            if (is_inter) {
                // Inter-swap: swap one job between machines
                if (j1.empty() || j2.empty()) { undo.move_type = -1; return; }
                undo.move_type = 1;
                undo.i1 = rnd(0, j1.size()-1);
                undo.i2 = rnd(0, j2.size()-1);
                std::swap(j1[undo.i1], j2[undo.i2]);
            } else {
                // Intra-swap: swap two jobs on mf
                if (j1.size() < 2) { undo.move_type = -1; return; }
                undo.move_type = 0;
                size_t a = rnd(0, j1.size()-1), b = rnd(0, j1.size()-1);
                while (a == b) b = rnd(0, j1.size()-1);
                undo.i1 = a; undo.i2 = b;
                std::swap(j1[a], j1[b]);
            }
        }
    } else {
        // Block moves (L >= 2).
        if (is_shift) {
            if (is_inter) {
                // Inter-block-shift: move block from mf to m2
                if ((int)j1.size() < L) { undo.move_type = -1; return; }
                undo.move_type = 6;
                size_t max_start = j1.size() - L;
                size_t i = rnd(0, max_start);
                undo.i1 = i;
                undo.saved_len1 = L;
                std::copy(j1.begin() + i, j1.begin() + i + L, ws.move_buf1.begin());
                j1.erase(j1.begin() + i, j1.begin() + i + L);
                size_t pos = rnd(0, j2.size());
                undo.i2 = pos;
                j2.insert(j2.begin() + pos, ws.move_buf1.begin(), ws.move_buf1.begin() + L);
            } else {
                // Intra-block-shift: relocate block within mf
                if ((int)j1.size() < L) { undo.move_type = -1; return; }
                undo.move_type = 5;
                size_t max_start = j1.size() - L;
                size_t i = rnd(0, max_start);
                undo.i1 = i;
                undo.saved_len1 = L;
                std::copy(j1.begin() + i, j1.begin() + i + L, ws.move_buf1.begin());
                j1.erase(j1.begin() + i, j1.begin() + i + L);
                size_t pos = rnd(0, j1.size());
                undo.i2 = pos;
                j1.insert(j1.begin() + pos, ws.move_buf1.begin(), ws.move_buf1.begin() + L);
            }
        } else {
            if (is_inter) {
                // Inter-block-swap: swap same-size blocks between machines
                if ((int)j1.size() < L || (int)j2.size() < L) { undo.move_type = -1; return; }
                undo.move_type = 7;
                size_t i1 = rnd(0, j1.size() - L);
                size_t i2 = rnd(0, j2.size() - L);
                undo.i1 = i1; undo.i2 = i2;
                undo.saved_len1 = undo.saved_len2 = L;
                std::copy(j1.begin() + i1, j1.begin() + i1 + L, ws.move_buf1.begin());
                std::copy(j2.begin() + i2, j2.begin() + i2 + L, ws.move_buf2.begin());
                std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + L, j1.begin() + i1);
                std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + L, j2.begin() + i2);
            } else {
                // Intra-block-swap: swap two non-overlapping blocks within mf
                if ((int)j1.size() < 2 * L) { undo.move_type = -1; return; }
                undo.move_type = 8;
                size_t max_pos = j1.size() - L;
                size_t a = rnd(0, max_pos), b = rnd(0, max_pos);
                int attempts = 0;
                while ((size_t)std::abs((int)a - (int)b) < (size_t)L && attempts++ < 20)
                    b = rnd(0, max_pos);
                if ((size_t)std::abs((int)a - (int)b) < (size_t)L) { undo.move_type = -1; return; }
                if (a > b) std::swap(a, b);  // ensure a < b
                undo.i1 = a; undo.i2 = b;
                undo.saved_len1 = L;
                std::copy(j1.begin() + a, j1.begin() + a + L, ws.move_buf1.begin());
                std::copy(j1.begin() + b, j1.begin() + b + L, ws.move_buf2.begin());
                std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + L, j1.begin() + a);
                std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + L, j1.begin() + b);
            }
        }
    }
}

void revert_move_internal(
    std::vector<std::vector<int>>& schedule, const MoveUndo& undo,
    const SAWorkspace& ws) {

    if (undo.move_type < 0) return;
    auto& j1 = schedule[undo.m1];
    auto& j2 = schedule[undo.m2];

    switch (undo.move_type) {
    case 0: std::swap(j1[undo.i1], j1[undo.i2]); break;
    case 1: std::swap(j1[undo.i1], j2[undo.i2]); break;
    case 2: {
        int job = j1[undo.i2];
        j1.erase(j1.begin() + undo.i2);
        j1.insert(j1.begin() + undo.i1, job);
        break;
    }
    case 3: {
        int job = j2[undo.i2];
        j2.erase(j2.begin() + undo.i2);
        j1.insert(j1.begin() + undo.i1, job);
        break;
    }
    case 5: {
        j1.erase(j1.begin() + undo.i2, j1.begin() + undo.i2 + undo.saved_len1);
        j1.insert(j1.begin() + undo.i1, ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1);
        break;
    }
    case 6: {
        j2.erase(j2.begin() + undo.i2, j2.begin() + undo.i2 + undo.saved_len1);
        j1.insert(j1.begin() + undo.i1, ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1);
        break;
    }
    case 7: {
        // Inter-block-swap: restore originals from buffers (same-size blocks)
        std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1, j1.begin() + undo.i1);
        std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + undo.saved_len2, j2.begin() + undo.i2);
        break;
    }
    case 8: {
        // Intra-block-swap: restore originals from buffers (same machine)
        std::copy(ws.move_buf1.begin(), ws.move_buf1.begin() + undo.saved_len1, j1.begin() + undo.i1);
        std::copy(ws.move_buf2.begin(), ws.move_buf2.begin() + undo.saved_len1, j1.begin() + undo.i2);
        break;
    }
    }
}


}
