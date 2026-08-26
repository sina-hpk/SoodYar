FROM node:20-alpine
WORKDIR /app

# Install dependencies for this workspace only.
COPY package.json ./
RUN npm install

COPY . .

RUN npx prisma generate

EXPOSE 4000
CMD ["npm", "run", "start"]
