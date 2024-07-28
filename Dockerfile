# Use the official Node.js image as the base image
FROM node:22

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json files to the working directory
COPY package*.json ./

# Install TeX Live (basic scheme to reduce image size; adjust as needed)
RUN apt-get update && apt-get install -y \
    texlive-base \
    texlive-latex-base \
    && apt-get clean

# Install the dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port the application runs on
EXPOSE 3000

# Define the command to run the application
CMD ["node", "dist/index.js"]
