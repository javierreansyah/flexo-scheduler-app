# Compile C++ files with:
# Remove-Item -Recurse -Force build, \*.egg-info -ErrorAction SilentlyContinue; pip install . --force-reinstall --no-cache-dir

from setuptools import setup
from pybind11.setup_helpers import Pybind11Extension, build_ext

# ─── THE "UNSAFE" MAX PERFORMANCE FLAGS ──────────────────────────────────────
compile_args = [
    # 1. CORE OPTIMIZATION
    "/O2",  # Maximize speed
    "/Ob3",  # Aggressive inlining (Critical for small functions)
    "/Oi",  # Intrinsic functions
    "/Ot",  # Favor fast code
    "/Oy",  # Omit frame pointer
    "/GT",  # Fiber-safe TLS optimizations
    # 2. ARCHITECTURE TUNING (i7-12700H / Alder Lake)
    "/arch:AVX2",  # Max safe instruction set
    "/favor:INTEL64",  # Tune for Intel 64-bit
    # 3. SAFETY STRIPPING (The "Unsafe" Speed Boosts)
    "/GS-",  # Disable Buffer Security Check (Faster function calls)
    "/Qspectre-",  # Disable Spectre mitigations (Faster branching)
    "/SDL-",  # Disable Security Development Lifecycle checks
    # 4. MATH & LOOP
    "/fp:fast",  # Fast floating point model
    "/Qpar",  # Auto-Parallelizer
    # 5. LINKING & UTILITY
    "/GL",  # Whole Program Optimization
    "/GF",  # String pooling
    "/Gy",  # Function-level linking
    "/Gw",  # Global data optimization (Better binary layout)
    "/Zc:inline",  # Remove unreferenced COMDATs
    "/DNDEBUG",  # Disable asserts
    "/D_ITERATOR_DEBUG_LEVEL=0",  # Disable vector bounds checking (CRITICAL)
]

# ─── LINKER FLAGS ────────────────────────────────────────────────────────────
link_args = [
    "/LTCG",  # Link-time code generation
    "/OPT:REF",  # Remove unreferenced functions
    "/OPT:ICF",  # Fold identical functions
    "/MACHINE:X64",  # Target 64-bit
]

ext_modules = [
    Pybind11Extension(
        "optimizer",
        ["src/optimizer.cpp"],
        cxx_std=17,
        extra_compile_args=compile_args,
        extra_link_args=link_args,
    ),
    Pybind11Extension(
        "ablation",
        ["src/ablation.cpp"],
        cxx_std=17,
        extra_compile_args=compile_args,
        extra_link_args=link_args,
    ),
    Pybind11Extension(
        "dispatch",
        ["src/dispatch.cpp"],
        cxx_std=17,
        extra_compile_args=compile_args,
        extra_link_args=link_args,
    ),
]

setup(
    name="optimizer",
    ext_modules=ext_modules,
    cmdclass={"build_ext": build_ext},
)
