CC ?= cc
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Werror -pedantic
CPPFLAGS ?= -D_POSIX_C_SOURCE=200809L -D_DARWIN_C_SOURCE
BIN := build/yutu-graph
SRC := src/yutu_graph.c

.PHONY: all clean test

all: $(BIN)

$(BIN): $(SRC)
	@mkdir -p build
	$(CC) $(CPPFLAGS) $(CFLAGS) $(SRC) -o $(BIN)

test: $(BIN)
	./tests/run.sh

clean:
	rm -f $(BIN)
