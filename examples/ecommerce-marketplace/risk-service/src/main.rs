use risk_service::evaluate_risk;
use std::io::{Read, Write};
use std::net::TcpListener;

fn main() {
    let listener = TcpListener::bind("0.0.0.0:8082").expect("bind :8082");
    println!("risk-service listening on :8082");
    for stream in listener.incoming() {
        let mut stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let body = request.split("\r\n\r\n").nth(1).unwrap_or("{}");
        let amount = extract_number(body, "order_amount").unwrap_or(0.0);
        let prior = extract_number(body, "prior_orders").unwrap_or(0.0) as u32;
        let decision = evaluate_risk(amount, prior);
        let payload = format!("{{\"decision\":\"{}\"}}", decision.as_str());
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            payload.len(),
            payload
        );
        let _ = stream.write_all(response.as_bytes());
    }
}

fn extract_number(body: &str, key: &str) -> Option<f64> {
    let marker = format!("\"{}\":", key);
    let idx = body.find(&marker)? + marker.len();
    let rest = &body[idx..];
    let end = rest.find(|c: char| c == ',' || c == '}').unwrap_or(rest.len());
    rest[..end].trim().parse::<f64>().ok()
}
