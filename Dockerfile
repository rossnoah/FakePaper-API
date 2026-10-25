# Use the official Node.js image as the base image
FROM node:24

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json files to the working directory
COPY package*.json ./

# Install TeX Live, including the recommended/extra packages generated papers commonly use
# (float, booktabs, xcolor, caption, multirow, siunitx, ...)
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-base \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-science \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install the dependencies
RUN npm ci

# Copy the rest of the application code to the working directory
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port the application runs on
EXPOSE 3000

# Define the command to run the application
CMD ["node", "dist/index.js"]
