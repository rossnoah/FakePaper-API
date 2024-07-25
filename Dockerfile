# Use the official Node.js 22 image as a base
FROM node:22

# Set the working directory in the container
WORKDIR /usr/src/app

# Install TeX Live (basic scheme to reduce image size; adjust as needed)
RUN apt-get update && apt-get install -y \
    texlive-base \
    texlive-latex-base \
    && apt-get clean

# Copy the rest of your application's code
COPY . .

# Install dependencies
RUN npm install

# Compile TypeScript code
RUN npm run build


# Expose the port your app runs on
EXPOSE 3000

# Command to run your app
# CMD ["node", "dist/index.js"]
# run with npm start
CMD ["npm", "start"]
