from __future__ import annotations

import sys


def main() -> None:
    if len(sys.argv) == 1:
        from app import main as app_main

        app_main()
        return

    from production_engine import main as engine_main

    engine_main()


if __name__ == "__main__":
    main()
