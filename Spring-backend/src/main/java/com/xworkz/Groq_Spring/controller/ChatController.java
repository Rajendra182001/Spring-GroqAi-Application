package com.xworkz.Groq_Spring.controller;

import com.xworkz.Groq_Spring.service.GroqService;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin("*")
@RequestMapping("/")
public class ChatController {

    private final GroqService groqService;

    public ChatController(GroqService groqService) {
        this.groqService = groqService;
    }

    @GetMapping("/chat")
    public String chat(@RequestParam String q) {
        return groqService.chat(q);
    }
}
