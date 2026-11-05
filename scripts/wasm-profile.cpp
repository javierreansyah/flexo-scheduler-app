// Only linked into the instrumented benchmark build; no filesystem is needed.
#include <emscripten/bind.h>
#include <cstdint>
#include <vector>
#include <stdexcept>
extern "C" uint64_t __llvm_profile_get_size_for_buffer();
extern "C" int __llvm_profile_write_buffer(char*);
emscripten::val profile() {
    std::vector<char> bytes(__llvm_profile_get_size_for_buffer());
    if (__llvm_profile_write_buffer(bytes.data())) throw std::runtime_error("Profile export failed");
    return emscripten::val::global("Uint8Array").new_(emscripten::val(emscripten::typed_memory_view(bytes.size(), reinterpret_cast<unsigned char*>(bytes.data()))));
}
EMSCRIPTEN_BINDINGS(flexo_profile) { emscripten::function("profile", &profile); }
