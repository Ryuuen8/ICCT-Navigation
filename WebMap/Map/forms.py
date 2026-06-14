from django import forms
from .models import HazardReport

class ReportForm(forms.ModelForm):
    class Meta:
        model = HazardReport
        fields = ['title', 'description', 'image']
        
    def clean_photo(self):
        photo = self.cleaned_data.get('image')
        if photo:
            if photo.size > 5 * 1024 * 1024:
                raise forms.ValidationError("Image Too Large")
            
            if not photo.content_type in ["image/jpeg", "image/png"]:
                raise forms.ValidationError("Only JPEG/PNG")
            
        return photo