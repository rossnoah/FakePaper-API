# Use the official Node.js 18 image as a base
FROM node:18

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json for installing dependencies
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of your application's code
COPY . .

# Compile TypeScript code
RUN npm run build

# Install TeX Live (basic scheme to reduce image size; adjust as needed)
RUN apt-get update && apt-get install -y --no-install-recommends texlive-latex-base && rm -rf /var/lib/apt/lists/*

# Expose the port your app runs on
EXPOSE 3000

# Command to run your app
CMD ["node", "dist/index.js"]
