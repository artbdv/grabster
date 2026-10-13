FROM node:24.19.0

WORKDIR /app

COPY . .
RUN npm install

EXPOSE 8787

CMD ["npm", "run", "start", "-w", "grabster-api"]
