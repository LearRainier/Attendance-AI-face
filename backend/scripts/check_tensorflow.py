"""
check_tensorflow.py - explain "Failed to load the native TensorFlow runtime".

Run it on the kiosk PC from the backend folder:

    .venv\\Scripts\\python.exe scripts\\check_tensorflow.py

It checks every known cause on Windows, then tries the real import and
prints the full error with a plain-language hint. A copy of the report is
saved to backend/logs/tensorflow_check.txt so it can be sent to a developer.
"""

import ctypes
import importlib.metadata as md
import io
import os
import platform
import sys
import traceback

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT_PATH = os.path.join(BACKEND_DIR, "logs", "tensorflow_check.txt")

_out = io.StringIO()

# DeepFace prints emoji; a cp1252 Windows console would crash on them.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def say(line=""):
    print(line)
    _out.write(line + "\n")


def check_python():
    ok = (3, 10) <= sys.version_info[:2] <= (3, 12)
    bits = platform.architecture()[0]
    say(f"[{'OK' if ok and bits == '64bit' else 'PROBLEM'}] Python {platform.python_version()} {bits}")
    if not ok:
        say("        TensorFlow needs Python 3.10, 3.11 or 3.12.")
    if bits != "64bit":
        say("        TensorFlow needs 64-bit Python.")
    return ok and bits == "64bit"


def check_cpu():
    if os.name != "nt":
        return True
    kernel32 = ctypes.windll.kernel32
    avx = bool(kernel32.IsProcessorFeaturePresent(39))   # PF_AVX_INSTRUCTIONS_AVAILABLE
    avx2 = bool(kernel32.IsProcessorFeaturePresent(40))  # PF_AVX2_INSTRUCTIONS_AVAILABLE
    say(f"[{'OK' if avx else 'PROBLEM'}] CPU AVX support: AVX={avx} AVX2={avx2} ({platform.processor()})")
    if not avx:
        say("        This CPU has no AVX. Official TensorFlow builds cannot run on it.")
        say("        Use a newer PC (most Intel Core / AMD Ryzen CPUs since 2011 have AVX).")
    return avx


def check_vc_runtime():
    if os.name != "nt":
        return True
    system32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
    needed = ["msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"]
    missing = [d for d in needed if not os.path.isfile(os.path.join(system32, d))]
    say(f"[{'OK' if not missing else 'PROBLEM'}] Microsoft Visual C++ runtime"
        + (f" - missing: {', '.join(missing)}" if missing else ""))
    if missing:
        say("        Install the latest Visual C++ Redistributable (x64):")
        say("        https://aka.ms/vs/17/release/vc_redist.x64.exe")
    return not missing


class _MemStatus(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def check_memory():
    if os.name != "nt":
        return True
    st = _MemStatus()
    st.dwLength = ctypes.sizeof(_MemStatus)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
    gb = 1024 ** 3
    total, free = st.ullTotalPhys / gb, st.ullAvailPhys / gb
    commit_free = st.ullAvailPageFile / gb
    ok = commit_free >= 2.0
    say(f"[{'OK' if ok else 'PROBLEM'}] Memory: {free:.1f} of {total:.1f} GB RAM free, "
        f"{commit_free:.1f} GB RAM+page file free")
    if not ok:
        say("        Too little memory for TensorFlow to load its DLLs (WinError 1455).")
        say("        Close other programs, restart the PC, and let Windows manage the page file size")
        say("        (System > About > Advanced system settings > Performance > Advanced > Virtual memory).")
    return ok


def check_packages():
    names = ["tensorflow", "tensorflow-intel", "tf-keras", "keras", "deepface",
             "numpy", "protobuf", "ml-dtypes", "h5py", "opencv-python"]
    say("Installed packages:")
    for n in names:
        try:
            say(f"        {n:16} {md.version(n)}")
        except md.PackageNotFoundError:
            say(f"        {n:16} (not installed)")


HINTS = [
    ("1455", "Windows ran out of memory / page file while loading TensorFlow. "
             "Restart the PC, close other apps, and enable 'System managed' page file size."),
    ("paging file", "Windows ran out of memory / page file while loading TensorFlow. "
                    "Restart the PC, close other apps, and enable 'System managed' page file size."),
    ("specified module could not be found", "A DLL TensorFlow needs is missing. Install the Visual C++ "
                                            "Redistributable x64: https://aka.ms/vs/17/release/vc_redist.x64.exe"),
    ("specified procedure could not be found", "A DLL version mismatch. Reinstall the Visual C++ Redistributable "
                                               "and reinstall TensorFlow (pip install --force-reinstall -r requirements.txt)."),
    ("dynamic link library (dll) initialization routine failed", "Usually a CPU without AVX, or a broken "
                                                                  "Visual C++ runtime. See the CPU and runtime lines above."),
    ("access is denied", "Antivirus or Windows Security blocked a TensorFlow DLL. Allow the project's .venv folder "
                         "in the antivirus, then reinstall TensorFlow."),
    ("numpy", "NumPy version incompatible with this TensorFlow. Reinstall with: "
              "pip install --force-reinstall -r requirements.txt"),
    ("protobuf", "protobuf version incompatible with this TensorFlow. Reinstall with: "
                 "pip install --force-reinstall -r requirements.txt"),
]


def try_import():
    say("")
    say("Importing TensorFlow (this can take ~20 seconds)...")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    try:
        import tensorflow as tf  # noqa: F401
        say(f"[OK] TensorFlow {tf.__version__} loaded.")
        from deepface import DeepFace  # noqa: F401
        say("[OK] DeepFace loaded.")
        return True
    except BaseException:
        tb = traceback.format_exc()
        say("[PROBLEM] TensorFlow failed to load. Full error:")
        say(tb)
        low = tb.lower()
        for needle, hint in HINTS:
            if needle in low:
                say("LIKELY CAUSE: " + hint)
                break
        else:
            say("LIKELY CAUSE: not recognised. Send logs/tensorflow_check.txt to the developer.")
        return False


def main():
    say("=" * 70)
    say("TensorFlow runtime check")
    say("=" * 70)
    check_python()
    check_cpu()
    check_vc_runtime()
    check_memory()
    check_packages()
    ok = try_import()
    try:
        os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
        with open(REPORT_PATH, "w", encoding="utf-8") as f:
            f.write(_out.getvalue())
        print(f"\nReport saved to {REPORT_PATH}")
    except OSError:
        pass
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
