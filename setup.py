import sys

from pybind11.setup_helpers import Pybind11Extension, build_ext
from setuptools import find_packages, setup

setup(
    name="flexo-scheduling",
    version="0.1.0",
    packages=find_packages(),
    package_data={"flexo": ["profiles.json", "example.json"]},
    python_requires=">=3.10",
    ext_modules=[Pybind11Extension(
        "flexo._core", ["src/optimizer.cpp"], cxx_std=17,
        depends=["src/engine.h", "src/moves.h"],
        extra_compile_args=["/O2", "/fp:precise"] if sys.platform == "win32" else ["-O3", "-pthread"],
        extra_link_args=[] if sys.platform == "win32" else ["-pthread"],
    )],
    cmdclass={"build_ext": build_ext},
    extras_require={"tuning": ["smac==2.3.1", "ConfigSpace==1.2.2", "tqdm>=4.66"], "test": ["pytest>=8"],
                    "experiments": ["matplotlib>=3.6", "jupyterlab>=4"]},
    entry_points={"console_scripts": ["flexo=flexo.__main__:main"]},
)
