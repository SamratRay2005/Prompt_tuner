import sys
import os

# Add parent directory to path so we can import the Flask app
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app import app
