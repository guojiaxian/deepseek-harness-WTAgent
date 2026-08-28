"""A deliberately flawed sample module that the code agent analyzes.

It mixes several static-analysis findings on purpose so a keyless round trip
has something to surface: a hardcoded secret, dynamic execution of a string,
a TODO marker, and a deeply nested conditional with high cyclomatic complexity.
"""

import os

API_SECRET = "sk-live-0123456789abcdef"  # hardcoded credential


def parse_config(raw: str) -> dict:
    # TODO: validate the input before evaluating it
    return eval(raw)  # dynamic execution of untrusted input


def classify(code: int) -> str:
    if code < 0:
        return "negative"
    elif code < 10:
        return "single-digit"
    elif code < 100:
        if code % 7 == 0:
            return "lucky"
        elif code % 2 == 0:
            return "even"
        else:
            return "odd"
    elif code < 1000:
        return "three-digit"
    else:
        return "large"


def main() -> None:
    print(os.environ.get("DEBUG", "nested example ready"))
    print(classify(49))


if __name__ == "__main__":
    main()