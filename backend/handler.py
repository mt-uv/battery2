import runpod

def handler(job):
    job_input = job["input"]
    text = job_input.get("text", "")

    # your backend logic here
    result = f"Backend received: {text}"

    return {"result": result}

runpod.serverless.start({"handler": handler})