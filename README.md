# LaTeX Server

## Overview

LaTeX Server is an Express.js application that compiles LaTeX documents into PDFs and uploads the resulting files to Vercel Blob storage.

## Features

- **LaTeX Compilation**: Converts LaTeX documents to PDF format.
- **File Isolation**: Handles each request in a separate temporary directory.
- **Vercel Blob Storage**: Uploads generated PDFs to Vercel Blob for easy access and sharing.

## Prerequisites

Before you begin, ensure you have met the following requirements:

- Node.js (v18 or later) installed on your machine.
- LaTeX installed on your machine if you wish to run locally. [LaTeX](https://www.latex-project.org/get/)
- Docker and Docker Compose installed, if you wish to run the application in a containerized environment.
- A Vercel account and an API token for Blob storage access.

## Installation

### Running Locally

To run LaTeX Server locally, follow these steps:

1. Clone the repository
2. Navigate to the project directory
3. Install the dependencies
4. Start the server:

```
node dist/index.js
```

### Running with Docker

To run LaTeX Server using Docker, ensure you have Docker and Docker Compose installed, then follow these steps:

1. Build the Docker image:

```
docker-compose build
```

2. Start the container:

```
docker-compose up
```

## Usage

Once the server is running, it exposes two endpoints:

- `GET /`: Returns the server status.
- `POST /latex`: Accepts a LaTeX document as plain text in the request body, compiles it into a PDF, uploads the PDF to Vercel Blob, and returns the URL to the uploaded file.

### Example Request

To compile a LaTeX document and retrieve the PDF URL, send a `POST` request to `/latex` with your LaTeX content in the body:
