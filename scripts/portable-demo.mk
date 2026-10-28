# SPDX-License-Identifier: GPL-2.0-only
# Adapted from ase_riscv_gem5_sim/programs/demo.mk.
# Modified in the personal fork on 2026-10-28: quote packaged compiler paths, including macOS application names.
CC ?= gcc
OBJDUMP ?= objdump
ASE_RISCV_MARCH ?= rv32imafd_zicsr_zifencei
CFLAGS := $$OPTIMIZATION_FLAGS -mcmodel=medlow -march=$(ASE_RISCV_MARCH) -mabi=ilp32 -mno-relax -Wall -Wextra -nostdlib
TARGET = $$program.elf

all: $(TARGET) $$program.dump

$(TARGET): $(ASM)
	"$(CC)" -o "$@" "$(ASM)" $(CFLAGS)

$$program.dump: $(TARGET)
	"$(OBJDUMP)" -d "$<" > "$@"

clean:
	rm -f "$(TARGET)" "$$program.dump"
