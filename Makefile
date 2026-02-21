SHELL := /usr/bin/env bash

.PHONY: start stop restart status logs logs-follow build

build:
	npm run build

start:
	./scripts/devctl.sh start

stop:
	./scripts/devctl.sh stop

restart:
	./scripts/devctl.sh restart

status:
	./scripts/devctl.sh status

logs:
	./scripts/devctl.sh logs

logs-follow:
	./scripts/devctl.sh logs --follow
