#!/bin/bash


cd backend
echo "Starting backend server..."
ADMIN_SECRET="secret123" go run .
