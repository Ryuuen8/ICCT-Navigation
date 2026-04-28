from django.shortcuts import render
from django.http import HttpResponse
# Create your views here.



def index(self):
    return render(self, 'index.html')

def pathfind():
    pass