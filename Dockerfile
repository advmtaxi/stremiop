FROM node:22-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm ci --only=production

# Bundle app source
COPY src/ ./src/
COPY public/ ./public/

# Bind to all network interfaces for Hugging Face/Docker
ENV HOST="0.0.0.0"
ENV PORT=7860

EXPOSE 7860

CMD [ "npm", "start" ]
