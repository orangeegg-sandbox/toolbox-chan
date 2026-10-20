use std::{collections::HashMap, sync::{Arc, Mutex}, time::Duration};

#[derive(Default)]
pub struct OnlineRequests(Mutex<HashMap<String, Arc<tokio::sync::Notify>>>);

fn validate_endpoint(endpoint: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| "Invalid API URL.".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Use HTTPS for remote providers, or HTTP for localhost.".into());
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("The API URL cannot contain credentials, queries, or fragments.".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn online_ocr(endpoint: String, api_key: String, body: serde_json::Value, request_id: String, state: tauri::State<'_, OnlineRequests>) -> Result<serde_json::Value, String> {
    let url = validate_endpoint(&endpoint)?;
    if body.to_string().len() > 40 * 1024 * 1024 { return Err("The online image request is too large.".into()); }
    let notify = Arc::new(tokio::sync::Notify::new());
    state.0.lock().map_err(|_| "Could not start request.".to_string())?.insert(request_id.clone(), notify.clone());
    let request = async {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(110)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Could not initialize the network client.".to_string())?;
        let mut request = client.post(url).json(&body);
        if !api_key.is_empty() { request = request.bearer_auth(api_key); }
        let mut response = request.send().await.map_err(|_| "Could not reach the OCR provider. Check your internet connection and API base URL.".to_string())?;
        if !response.status().is_success() { return Err(format!("Provider returned HTTP {}. Check your API key, model, endpoint, and quota.", response.status().as_u16())); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "The OCR response was interrupted.".to_string())? {
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 { return Err("The provider response is too large.".into()); }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "The provider did not return a valid JSON response.".to_string())
    };
    let result = tokio::select! {
        result = request => result,
        _ = notify.notified() => Err("Recognition cancelled.".to_string()),
    };
    if let Ok(mut requests) = state.0.lock() { requests.remove(&request_id); }
    result
}

#[tauri::command]
pub fn cancel_online_ocr(request_id: String, state: tauri::State<'_, OnlineRequests>) {
    if let Ok(requests) = state.0.lock() {
        if let Some(notify) = requests.get(&request_id) { notify.notify_one(); }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_endpoint;
    #[test]
    fn endpoints_require_secure_remote_transport() {
        assert!(validate_endpoint("https://api.openai.com/v1/chat/completions").is_ok());
        assert!(validate_endpoint("http://localhost:1234/v1/chat/completions").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:1234/v1/chat/completions").is_ok());
        assert!(validate_endpoint("http://example.com/v1/chat/completions").is_err());
        assert!(validate_endpoint("https://user:password@example.com/v1").is_err());
        assert!(validate_endpoint("file:///etc/passwd").is_err());
    }
}
