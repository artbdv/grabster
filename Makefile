deploy:
	git pull origin main
	docker compose build && docker compose up -d

deploy-api:
	git pull origin main
	docker compose build grabster-api && docker compose up -d grabster-api

deploy-app:
	git pull origin main
	docker compose build grabster-app && docker compose up -d grabster-app
