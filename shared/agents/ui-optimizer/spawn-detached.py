#!/usr/bin/env python3
import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Spawn a detached command and print its final PID.")
    parser.add_argument("--pid-file", required=True)
    parser.add_argument("--stdout", required=True)
    parser.add_argument("--stderr", required=True)
    parser.add_argument("--cwd")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("missing command")

    read_fd, write_fd = os.pipe()
    first = os.fork()
    if first:
        os.close(write_fd)
        data = os.read(read_fd, 64).decode("ascii", "replace").strip()
        os.close(read_fd)
        if not data:
            return 1
        print(data)
        return 0

    os.close(read_fd)
    os.setsid()
    second = os.fork()
    if second:
        os._exit(0)

    if args.cwd:
        os.chdir(args.cwd)

    pid = str(os.getpid())
    with open(args.pid_file, "w", encoding="ascii") as f:
        f.write(pid + "\n")
    os.write(write_fd, pid.encode("ascii") + b"\n")
    os.close(write_fd)

    stdout_fd = os.open(args.stdout, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    stderr_fd = os.open(args.stderr, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(stdout_fd, 1)
    os.dup2(stderr_fd, 2)
    os.close(stdout_fd)
    os.close(stderr_fd)
    stdin_fd = os.open(os.devnull, os.O_RDONLY)
    os.dup2(stdin_fd, 0)
    os.close(stdin_fd)
    os.execvp(command[0], command)
    return 127


if __name__ == "__main__":
    raise SystemExit(main())
