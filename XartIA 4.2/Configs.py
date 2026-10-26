.PHONY: all build test deploy init finalize verify clean

NETWORK ?= amoy

all: build test

build:
	forge build

test:
	forge test

deploy:
	mkdir -p deployments
	NETWORK=$(NETWORK) forge script script/Deploy.s.sol \
		--rpc-url $$(grep '^rpc_url' config/$(NETWORK).toml | cut -d'"' -f2) \
		--private-key $(PRIVATE_KEY) --broadcast

init:
	NETWORK=$(NETWORK) forge script script/Initialize.s.sol \
		--rpc-url $$(grep '^rpc_url' config/$(NETWORK).toml | cut -d'"' -f2) \
		--private-key $(PRIVATE_KEY) --broadcast

finalize:
	NETWORK=$(NETWORK) forge script script/Finalize.s.sol \
		--rpc-url $$(grep '^rpc_url' config/$(NETWORK).toml | cut -d'"' -f2) \
		--private-key $(PRIVATE_KEY) --broadcast

verify:
	NETWORK=$(NETWORK) bash scripts/shell/verify.sh

clean:
	rm -rf out cache deployments