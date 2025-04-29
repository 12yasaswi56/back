# main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from bs4 import BeautifulSoup
import json
from typing import List, Optional
import re
import time
import random

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class Job(BaseModel):
    title: str
    company: str
    location: str
    description: str
    url: str
    source: str
    posted_date: Optional[str] = None
    salary: Optional[str] = None

class SearchRequest(BaseModel):
    keywords: str
    location: Optional[str] = None
    num_pages: Optional[int] = 1

# User Agents for scraping
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1 Safari/605.1.15"
]

def get_random_user_agent():
    return random.choice(USER_AGENTS)

# Scraping functions for different job sites
def scrape_indeed(search_request: SearchRequest) -> List[Job]:
    jobs = []
    base_url = "https://www.indeed.com"
    
    for page in range(search_request.num_pages):
        params = {
            'q': search_request.keywords,
            'l': search_request.location,
            'start': page * 10
        }
        
        headers = {
            'User-Agent': get_random_user_agent()
        }
        
        try:
            response = requests.get(f"{base_url}/jobs", params=params, headers=headers)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            job_cards = soup.find_all('div', class_='job_seen_beacon')
            
            for card in job_cards:
                title_elem = card.find('h2', class_='jobTitle')
                company_elem = card.find('span', class_='companyName')
                location_elem = card.find('div', class_='companyLocation')
                salary_elem = card.find('div', class_='metadata salary-snippet-container')
                
                if title_elem and company_elem and location_elem:
                    job_url = base_url + title_elem.find('a')['href'] if title_elem.find('a') else None
                    
                    job = Job(
                        title=title_elem.text.strip(),
                        company=company_elem.text.strip(),
                        location=location_elem.text.strip(),
                        description="",  # Indeed requires visiting each job page for full description
                        url=job_url,
                        source="Indeed",
                        salary=salary_elem.text.strip() if salary_elem else None
                    )
                    jobs.append(job)
            
            time.sleep(random.uniform(1, 3))  # Be polite with delays
            
        except Exception as e:
            print(f"Error scraping Indeed: {e}")
            continue
    
    return jobs

def scrape_linkedin(search_request: SearchRequest) -> List[Job]:
    jobs = []
    base_url = "https://www.linkedin.com/jobs/search"
    
    for page in range(search_request.num_pages):
        params = {
            'keywords': search_request.keywords,
            'location': search_request.location,
            'start': page * 25
        }
        
        headers = {
            'User-Agent': get_random_user_agent()
        }
        
        try:
            response = requests.get(base_url, params=params, headers=headers)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            job_cards = soup.find_all('div', class_='base-card')
            
            for card in job_cards:
                title_elem = card.find('h3', class_='base-search-card__title')
                company_elem = card.find('h4', class_='base-search-card__subtitle')
                location_elem = card.find('span', class_='job-search-card__location')
                job_url = card.find('a', class_='base-card__full-link')['href'] if card.find('a', class_='base-card__full-link') else None
                
                if title_elem and company_elem and location_elem and job_url:
                    job = Job(
                        title=title_elem.text.strip(),
                        company=company_elem.text.strip(),
                        location=location_elem.text.strip(),
                        description="",  # LinkedIn requires visiting each job page
                        url=job_url,
                        source="LinkedIn"
                    )
                    jobs.append(job)
            
            time.sleep(random.uniform(2, 4))  # Be extra polite with LinkedIn
            
        except Exception as e:
            print(f"Error scraping LinkedIn: {e}")
            continue
    
    return jobs

def scrape_glassdoor(search_request: SearchRequest) -> List[Job]:
    jobs = []
    base_url = "https://www.glassdoor.com/Job/jobs.htm"
    
    for page in range(search_request.num_pages):
        params = {
            'sc.keyword': search_request.keywords,
            'locT': 'C',
            'locId': '1132348',  # Default to New York, should be dynamic
            'locKeyword': search_request.location,
            'suggestCount': '0',
            'suggestChosen': 'false',
            'clickSource': 'searchBtn',
            'typedKeyword': search_request.keywords,
            'context': 'Jobs',
            'dropdown': '0',
            'page': page + 1
        }
        
        headers = {
            'User-Agent': get_random_user_agent(),
            'Accept-Language': 'en-US,en;q=0.9'
        }
        
        try:
            response = requests.get(base_url, params=params, headers=headers)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            job_cards = soup.find_all('li', class_='react-job-listing')
            
            for card in job_cards:
                title_elem = card.find('a', class_='jobLink')
                company_elem = card.find('div', class_='d-flex justify-content-between align-items-start')
                location_elem = card.find('div', class_='location')
                
                if title_elem and company_elem and location_elem:
                    job_url = "https://www.glassdoor.com" + title_elem['href'] if title_elem.get('href') else None
                    
                    job = Job(
                        title=title_elem.text.strip(),
                        company=company_elem.text.strip(),
                        location=location_elem.text.strip(),
                        description="",  # Glassdoor requires visiting each job page
                        url=job_url,
                        source="Glassdoor"
                    )
                    jobs.append(job)
            
            time.sleep(random.uniform(3, 5))  # Glassdoor is particularly sensitive
            
        except Exception as e:
            print(f"Error scraping Glassdoor: {e}")
            continue
    
    return jobs

# API Endpoints
@app.post("/search-jobs", response_model=List[Job])
async def search_jobs(search_request: SearchRequest):
    try:
        all_jobs = []
        
        # Scrape from multiple sources
        all_jobs.extend(scrape_indeed(search_request))
        all_jobs.extend(scrape_linkedin(search_request))
        all_jobs.extend(scrape_glassdoor(search_request))
        
        # Remove duplicates based on title and company
        unique_jobs = []
        seen = set()
        
        for job in all_jobs:
            key = (job.title.lower(), job.company.lower())
            if key not in seen:
                seen.add(key)
                unique_jobs.append(job)
        
        return unique_jobs
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)