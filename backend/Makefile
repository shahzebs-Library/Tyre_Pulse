.PHONY: build run test vet tidy migrate-up migrate-down docker-up docker-down

build:
	go build ./...

run:
	go run ./cmd/api

worker:
	go run ./cmd/worker

test:
	go test ./...

vet:
	go vet ./...

tidy:
	go mod tidy

# Requires goose: go install github.com/pressly/goose/v3/cmd/goose@latest
migrate-up:
	goose -dir ./migrations postgres "$$DATABASE_URL" up

migrate-down:
	goose -dir ./migrations postgres "$$DATABASE_URL" down

docker-up:
	docker compose -f ../docker-compose.dev.yml up --build

docker-down:
	docker compose -f ../docker-compose.dev.yml down
