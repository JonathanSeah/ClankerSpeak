import os
import google.generativeai as genai
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
load_dotenv()
genai.configure(api_key=os.getenv('GOOGLE_API_KEY'))
app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'doc', 'docx', 'md'}
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/clear', methods=['POST'])
def clear_files():
    global uploaded_files
    uploaded_files = {}
    return jsonify({'message': 'All files cleared'})
if __name__ == '__main__':
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    app.run(debug=True, port=5000)

uploaded_files = {}
@app.route('/')
def index():
    return render_template('index.html')
@app.route('/upload', methods=['POST'])
def upload_files():
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided'}), 400
    
    files = request.files.getlist('files')
    uploaded_file_objects = []
    
    for file in files:
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            try:
                gemini_file = genai.upload_file(filepath)
                uploaded_files[filename] = gemini_file
                uploaded_file_objects.append({
                    'name': filename,
                    'uri': gemini_file.uri,
                    'mime_type': gemini_file.mime_type
                })
            except Exception as e:
                return jsonify({'error': f'Failed to upload {filename}: {str(e)}'}), 500
            finally:
                os.remove(filepath)
    
    return jsonify({
        'message': f'Successfully uploaded {len(uploaded_file_objects)} files',
        'files': uploaded_file_objects
    })

@app.route('/ask', methods=['POST'])
def ask_question():
    data = request.get_json()
    question = data.get('question')
    
    if not question:
        return jsonify({'error': 'No question provided'}), 400
    
    if not uploaded_files:
        return jsonify({'error': 'No files uploaded yet'}), 400
    
    try:
        model = genai.GenerativeModel('gemini-2.0-flash-exp')
        
        file_refs = list(uploaded_files.values())
        
        prompt = f"""You are a helpful research assistant. Answer the following question based on the uploaded documents. 
        Provide specific citations with page numbers or section references when possible.
        
        Question: {question}
        
        If the answer isn't in the documents, say so clearly."""
        
        response = model.generate_content([prompt] + file_refs)
        
        return jsonify({
            'answer': response.text,
            'files_referenced': len(file_refs)
        })
    
    except Exception as e:
        return jsonify({'error': f'Failed to generate answer: {str(e)}'}), 500