-- clases palette: move children still on the old default colours to teal and lime.
UPDATE children SET colour = '#005451' WHERE colour = '#1F6B52';
UPDATE children SET colour = '#C0CF58' WHERE colour = '#3D5BA9';
